import express, { Request, Response } from "express";
import Redis from "ioredis";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
  parseTable,
} from "../utils/validators";
import { pool } from "../db";

const router = express.Router();

// Initialize Redis client
const redis = new Redis({ host: "localhost", port: 6379 });

/**
 * Cache key: lat/lon rounded to 4 decimal places (~11m grid)
 */
function cacheKey(lat: number, lon: number): string {
  return `geofence:${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

/**
 * POST /exp/06/no-cache — Baseline: direct DB query
 */
router.post(
  "/no-cache",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, table: tableRaw } = req.body as {
        points: unknown;
        table?: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);
      const table = parseTable(tableRaw);

      const results = [];
      let totalDbLatency = 0;
      let queryCount = 0;

      for (let i = 0; i < points.length; i++) {
        const lat = lats[i];
        const lon = lons[i];

        const t0 = performance.now();
        const dbResult = await pool.query(
          `SELECT DISTINCT p.osm_id::text
           FROM ${table} p
           WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
           LIMIT 1000`,
          [lon, lat]
        );
        const latency = performance.now() - t0;
        totalDbLatency += latency;
        queryCount++;

        results.push({
          idx: i,
          polygonIds: dbResult.rows.map((r: any) => r.osm_id),
          source: "db",
          dbQueryLatencyMs: latency.toFixed(2),
        });
      }

      res.json({
        count: points.length,
        results,
        cacheStats: {
          hits: 0,
          misses: queryCount,
          hitRate: "0.00%",
          avgCacheHitLatencyMs: 0,
          avgDbQueryLatencyMs:
            queryCount > 0 ? (totalDbLatency / queryCount).toFixed(2) : 0,
          totalLatencyMs: totalDbLatency.toFixed(2),
        },
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

/**
 * POST /exp/06/cache — Redis key-value cache with TTL
 */
router.post(
  "/cache",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, table: tableRaw } = req.body as {
        points: unknown;
        table?: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);
      const table = parseTable(tableRaw);

      const results = [];
      let hitCount = 0;
      let missCount = 0;
      let totalCacheHitLatency = 0;
      let totalDbLatency = 0;

      for (let i = 0; i < points.length; i++) {
        const lat = lats[i];
        const lon = lons[i];

        const t0 = performance.now();
        const key = cacheKey(lat, lon);

        // Try Redis cache
        const cached = await redis.get(key);
        const hitLatency = performance.now() - t0;

        if (cached) {
          // Cache hit
          hitCount++;
          totalCacheHitLatency += hitLatency;

          results.push({
            idx: i,
            polygonIds: JSON.parse(cached),
            source: "cache",
            cacheHitLatencyMs: hitLatency.toFixed(2),
          });
        } else {
          // Cache miss: query DB
          const dbT0 = performance.now();
          const dbResult = await pool.query(
            `SELECT DISTINCT p.osm_id::text
             FROM ${table} p
             WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
             LIMIT 1000`,
            [lon, lat]
          );
          const dbQueryLatency = performance.now() - dbT0;
          totalDbLatency += dbQueryLatency;

          const polygonIds = dbResult.rows.map((r: any) => r.osm_id);

          // Store in Redis with 3600s TTL
          await redis.setex(
            key,
            3600,
            JSON.stringify(polygonIds)
          );

          missCount++;

          results.push({
            idx: i,
            polygonIds,
            source: "db",
            dbQueryLatencyMs: dbQueryLatency.toFixed(2),
            cacheHitLatencyMs: hitLatency.toFixed(2),
          });
        }
      }

      const totalHits = hitCount + missCount;
      const hitRate =
        totalHits > 0 ? ((hitCount / totalHits) * 100).toFixed(2) : "0.00";

      res.json({
        count: points.length,
        results,
        cacheStats: {
          hits: hitCount,
          misses: missCount,
          hitRate: `${hitRate}%`,
          avgCacheHitLatencyMs:
            hitCount > 0
              ? (totalCacheHitLatency / hitCount).toFixed(2)
              : 0,
          avgDbQueryLatencyMs:
            missCount > 0
              ? (totalDbLatency / missCount).toFixed(2)
              : 0,
          totalLatencyMs: (totalCacheHitLatency + totalDbLatency).toFixed(2),
        },
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

export default router;
