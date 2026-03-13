import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
  parseTable,
} from "../utils/validators";
import { GeohashTileSystem } from "../utils/tile-cache";
import { pool } from "../db";

const router = express.Router();

// Initialize separate caches for each proximity radius variant
const cache1km = new GeohashTileSystem(7, 512);
const cache3km = new GeohashTileSystem(7, 512);
const cache5km = new GeohashTileSystem(7, 512);

/**
 * Haversine distance between two points (meters)
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Process a single point: try exact cache hit, proximity hit, then DB query
 * Key fix: proximity hits skip the DB query entirely
 */
async function processPoint(
  cache: GeohashTileSystem,
  maxDistM: number,
  table: string,
  lat: number,
  lon: number,
  idx: number
): Promise<{
  idx: number;
  polygonIds: string[];
  source: "cache-exact" | "cache-proximity" | "db";
  distanceM?: number;
  cacheHitLatencyMs?: number;
  dbQueryLatencyMs?: number;
}> {
  const t0 = performance.now();

  // Try exact tile match
  const exact = cache.get(lat, lon);
  if (exact.hit && exact.entry) {
    const hitLatency = performance.now() - t0;
    return {
      idx,
      polygonIds: exact.entry.polygonIds,
      source: "cache-exact",
      distanceM: 0,
      cacheHitLatencyMs: hitLatency,
    };
  }

  // Try proximity match (this is the key fix: no DB query on proximity hit)
  const prox = cache.getProximity(lat, lon, maxDistM);
  if (prox.hit && prox.entry) {
    const hitLatency = performance.now() - t0;
    return {
      idx,
      polygonIds: prox.entry.polygonIds,
      source: "cache-proximity",
      distanceM: Math.round(
        haversineDistance(lat, lon, prox.entry.lat, prox.entry.lon)
      ),
      cacheHitLatencyMs: hitLatency,
    };
  }

  // Full miss: query DB and store in cache
  const dbT0 = performance.now();
  const dbResult = await pool.query(
    `SELECT DISTINCT p.osm_id::text
     FROM ${table} p
     WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
     LIMIT 1000`,
    [lon, lat]
  );
  const dbQueryLatency = performance.now() - dbT0;
  const totalLatency = performance.now() - t0;

  const polygonIds = dbResult.rows.map((r: any) => r.osm_id);
  cache.set(lat, lon, polygonIds);

  return {
    idx,
    polygonIds,
    source: "db",
    dbQueryLatencyMs: dbQueryLatency,
    cacheHitLatencyMs: totalLatency,
  };
}

/**
 * Baseline: no cache, direct DB query
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
          dbQueryLatencyMs: latency,
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
 * Cache with 1km proximity radius
 */
router.post(
  "/cache-1km",
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

        const result = await processPoint(cache1km, 1000, table, lat, lon, i);
        results.push(result);

        if (result.source !== "db") {
          hitCount++;
          if (result.cacheHitLatencyMs) {
            totalCacheHitLatency += result.cacheHitLatencyMs;
          }
        } else {
          missCount++;
          if (result.dbQueryLatencyMs) {
            totalDbLatency += result.dbQueryLatencyMs;
          }
        }
      }

      const hitRate =
        ((hitCount / (hitCount + missCount)) * 100).toFixed(2);

      res.json({
        count: points.length,
        results,
        cacheStats: {
          hits: hitCount,
          misses: missCount,
          hitRate: `${hitRate}%`,
          avgCacheHitLatencyMs:
            hitCount > 0 ? (totalCacheHitLatency / hitCount).toFixed(2) : 0,
          avgDbQueryLatencyMs:
            missCount > 0 ? (totalDbLatency / missCount).toFixed(2) : 0,
          totalLatencyMs: (totalCacheHitLatency + totalDbLatency).toFixed(2),
        },
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

/**
 * Cache with 3km proximity radius
 */
router.post(
  "/cache-3km",
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

        const result = await processPoint(cache3km, 3000, table, lat, lon, i);
        results.push(result);

        if (result.source !== "db") {
          hitCount++;
          if (result.cacheHitLatencyMs) {
            totalCacheHitLatency += result.cacheHitLatencyMs;
          }
        } else {
          missCount++;
          if (result.dbQueryLatencyMs) {
            totalDbLatency += result.dbQueryLatencyMs;
          }
        }
      }

      const hitRate =
        ((hitCount / (hitCount + missCount)) * 100).toFixed(2);

      res.json({
        count: points.length,
        results,
        cacheStats: {
          hits: hitCount,
          misses: missCount,
          hitRate: `${hitRate}%`,
          avgCacheHitLatencyMs:
            hitCount > 0 ? (totalCacheHitLatency / hitCount).toFixed(2) : 0,
          avgDbQueryLatencyMs:
            missCount > 0 ? (totalDbLatency / missCount).toFixed(2) : 0,
          totalLatencyMs: (totalCacheHitLatency + totalDbLatency).toFixed(2),
        },
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

/**
 * Cache with 5km proximity radius
 */
router.post(
  "/cache-5km",
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

        const result = await processPoint(cache5km, 5000, table, lat, lon, i);
        results.push(result);

        if (result.source !== "db") {
          hitCount++;
          if (result.cacheHitLatencyMs) {
            totalCacheHitLatency += result.cacheHitLatencyMs;
          }
        } else {
          missCount++;
          if (result.dbQueryLatencyMs) {
            totalDbLatency += result.dbQueryLatencyMs;
          }
        }
      }

      const hitRate =
        ((hitCount / (hitCount + missCount)) * 100).toFixed(2);

      res.json({
        count: points.length,
        results,
        cacheStats: {
          hits: hitCount,
          misses: missCount,
          hitRate: `${hitRate}%`,
          avgCacheHitLatencyMs:
            hitCount > 0 ? (totalCacheHitLatency / hitCount).toFixed(2) : 0,
          avgDbQueryLatencyMs:
            missCount > 0 ? (totalDbLatency / missCount).toFixed(2) : 0,
          totalLatencyMs: (totalCacheHitLatency + totalDbLatency).toFixed(2),
        },
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

/**
 * Clear all caches
 */
router.post("/clear-cache", (_req: Request, res: Response) => {
  cache1km.clear();
  cache3km.clear();
  cache5km.clear();
  res.json({ ok: true, message: "All caches cleared" });
});

export default router;
