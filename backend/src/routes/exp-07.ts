import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
  parseTable,
} from "../utils/validators";
import { GeohashTileSystem, H3TileSystem, QuadkeyTileSystem, CacheStats } from "../utils/tile-cache";
import { pool } from "../db";

const router = express.Router();

// Initialize tile cache systems with 1GB max memory each
const geohashCache = new GeohashTileSystem(7, 1024);
const h3Cache = new H3TileSystem(8, 1024);
const quadkeyCache = new QuadkeyTileSystem(14, 1024);

// Track accuracy of proximity matches
let proximityAccuracy: { correct: number; total: number } = { correct: 0, total: 0 };

/**
 * Query with geohash tile caching
 */
router.post(
  "/batch-geohash",
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
      const cacheHits = [];

      for (let i = 0; i < points.length; i++) {
        const lat = lats[i];
        const lon = lons[i];

        // Try exact tile match
        const exact = geohashCache.get(lat, lon);
        if (exact.hit && exact.entry) {
          results.push({ idx: i, matches: exact.entry.polygonIds.map((id) => ({ osm_id: id, name: null })) });
          cacheHits.push({ idx: i, type: "exact" });
          continue;
        }

        // Try proximity match (100m, 500m, 1km)
        let proximity = geohashCache.getProximity(lat, lon, 100);
        let proximityType = "100m";
        if (!proximity.hit) {
          proximity = geohashCache.getProximity(lat, lon, 500);
          proximityType = "500m";
        }
        if (!proximity.hit) {
          proximity = geohashCache.getProximity(lat, lon, 1000);
          proximityType = "1km";
        }

        if (proximity.hit && proximity.entry) {
          // Check accuracy: compare with fresh DB query
          const dbResult = await pool.query(
            `SELECT DISTINCT p.osm_id::text
             FROM ${table} p
             WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
             LIMIT 1000`,
            [lon, lat]
          );
          const dbIds = new Set(dbResult.rows.map((r: any) => r.osm_id));
          const cachedIds = new Set(proximity.entry.polygonIds);
          const isAccurate = dbIds.size === cachedIds.size &&
            Array.from(dbIds).every((id) => cachedIds.has(id));
          
          if (isAccurate) {
            proximityAccuracy.correct++;
          }
          proximityAccuracy.total++;
          geohashCache.getStats(); // This internally tracks accuracy

          results.push({ idx: i, matches: proximity.entry.polygonIds.map((id) => ({ osm_id: id, name: null })) });
          cacheHits.push({ idx: i, type: `proximity_${proximityType}` });
          continue;
        }

        // Cache miss: query DB
        const dbResult = await pool.query(
          `SELECT DISTINCT p.osm_id::text
           FROM ${table} p
           WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
           LIMIT 1000`,
          [lon, lat]
        );

        const polygonIds = dbResult.rows.map((r: any) => r.osm_id);
        geohashCache.set(lat, lon, polygonIds);

        results.push({ idx: i, matches: polygonIds.map((id) => ({ osm_id: id, name: null })) });
        cacheHits.push({ idx: i, type: "db_miss" });
      }

      const stats = geohashCache.getStats();
      const hitRate = (stats.hits / (stats.hits + stats.misses)) * 100 || 0;

      res.json({
        count: points.length,
        results,
        cacheStats: {
          hitRate: hitRate.toFixed(2),
          exactHits: stats.exactMatches,
          proximityHits: stats.proximityMatches,
          misses: stats.misses,
          memoryMB: stats.memoryMB.toFixed(2),
          proximityAccuracy: proximityAccuracy.total > 0
            ? ((proximityAccuracy.correct / proximityAccuracy.total) * 100).toFixed(2)
            : "N/A",
        },
        cacheHits,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

/**
 * Query with H3 tile caching
 */
router.post(
  "/batch-h3",
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
      const cacheHits = [];

      for (let i = 0; i < points.length; i++) {
        const lat = lats[i];
        const lon = lons[i];

        // Try exact tile match
        const exact = h3Cache.get(lat, lon);
        if (exact.hit && exact.entry) {
          results.push({ idx: i, matches: exact.entry.polygonIds.map((id) => ({ osm_id: id, name: null })) });
          cacheHits.push({ idx: i, type: "exact" });
          continue;
        }

        // Try proximity match (100m, 500m, 1km)
        let proximity = h3Cache.getProximity(lat, lon, 100);
        let proximityType = "100m";
        if (!proximity.hit) {
          proximity = h3Cache.getProximity(lat, lon, 500);
          proximityType = "500m";
        }
        if (!proximity.hit) {
          proximity = h3Cache.getProximity(lat, lon, 1000);
          proximityType = "1km";
        }

        if (proximity.hit && proximity.entry) {
          // Check accuracy
          const dbResult = await pool.query(
            `SELECT DISTINCT p.osm_id::text
             FROM ${table} p
             WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
             LIMIT 1000`,
            [lon, lat]
          );
          const dbIds = new Set(dbResult.rows.map((r: any) => r.osm_id));
          const cachedIds = new Set(proximity.entry.polygonIds);
          const isAccurate = dbIds.size === cachedIds.size &&
            Array.from(dbIds).every((id) => cachedIds.has(id));
          
          if (isAccurate) {
            proximityAccuracy.correct++;
          }
          proximityAccuracy.total++;

          results.push({ idx: i, matches: proximity.entry.polygonIds.map((id) => ({ osm_id: id, name: null })) });
          cacheHits.push({ idx: i, type: `proximity_${proximityType}` });
          continue;
        }

        // Cache miss: query DB
        const dbResult = await pool.query(
          `SELECT DISTINCT p.osm_id::text
           FROM ${table} p
           WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
           LIMIT 1000`,
          [lon, lat]
        );

        const polygonIds = dbResult.rows.map((r: any) => r.osm_id);
        h3Cache.set(lat, lon, polygonIds);

        results.push({ idx: i, matches: polygonIds.map((id) => ({ osm_id: id, name: null })) });
        cacheHits.push({ idx: i, type: "db_miss" });
      }

      const stats = h3Cache.getStats();
      const hitRate = (stats.hits / (stats.hits + stats.misses)) * 100 || 0;

      res.json({
        count: points.length,
        results,
        cacheStats: {
          hitRate: hitRate.toFixed(2),
          exactHits: stats.exactMatches,
          proximityHits: stats.proximityMatches,
          misses: stats.misses,
          memoryMB: stats.memoryMB.toFixed(2),
          proximityAccuracy: proximityAccuracy.total > 0
            ? ((proximityAccuracy.correct / proximityAccuracy.total) * 100).toFixed(2)
            : "N/A",
        },
        cacheHits,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

/**
 * Query with Quadkey tile caching
 */
router.post(
  "/batch-quadkey",
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
      const cacheHits = [];

      for (let i = 0; i < points.length; i++) {
        const lat = lats[i];
        const lon = lons[i];

        // Try exact tile match
        const exact = quadkeyCache.get(lat, lon);
        if (exact.hit && exact.entry) {
          results.push({ idx: i, matches: exact.entry.polygonIds.map((id) => ({ osm_id: id, name: null })) });
          cacheHits.push({ idx: i, type: "exact" });
          continue;
        }

        // Try proximity match (100m, 500m, 1km)
        let proximity = quadkeyCache.getProximity(lat, lon, 100);
        let proximityType = "100m";
        if (!proximity.hit) {
          proximity = quadkeyCache.getProximity(lat, lon, 500);
          proximityType = "500m";
        }
        if (!proximity.hit) {
          proximity = quadkeyCache.getProximity(lat, lon, 1000);
          proximityType = "1km";
        }

        if (proximity.hit && proximity.entry) {
          // Check accuracy
          const dbResult = await pool.query(
            `SELECT DISTINCT p.osm_id::text
             FROM ${table} p
             WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
             LIMIT 1000`,
            [lon, lat]
          );
          const dbIds = new Set(dbResult.rows.map((r: any) => r.osm_id));
          const cachedIds = new Set(proximity.entry.polygonIds);
          const isAccurate = dbIds.size === cachedIds.size &&
            Array.from(dbIds).every((id) => cachedIds.has(id));
          
          if (isAccurate) {
            proximityAccuracy.correct++;
          }
          proximityAccuracy.total++;

          results.push({ idx: i, matches: proximity.entry.polygonIds.map((id) => ({ osm_id: id, name: null })) });
          cacheHits.push({ idx: i, type: `proximity_${proximityType}` });
          continue;
        }

        // Cache miss: query DB
        const dbResult = await pool.query(
          `SELECT DISTINCT p.osm_id::text
           FROM ${table} p
           WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
           LIMIT 1000`,
          [lon, lat]
        );

        const polygonIds = dbResult.rows.map((r: any) => r.osm_id);
        quadkeyCache.set(lat, lon, polygonIds);

        results.push({ idx: i, matches: polygonIds.map((id) => ({ osm_id: id, name: null })) });
        cacheHits.push({ idx: i, type: "db_miss" });
      }

      const stats = quadkeyCache.getStats();
      const hitRate = (stats.hits / (stats.hits + stats.misses)) * 100 || 0;

      res.json({
        count: points.length,
        results,
        cacheStats: {
          hitRate: hitRate.toFixed(2),
          exactHits: stats.exactMatches,
          proximityHits: stats.proximityMatches,
          misses: stats.misses,
          memoryMB: stats.memoryMB.toFixed(2),
          proximityAccuracy: proximityAccuracy.total > 0
            ? ((proximityAccuracy.correct / proximityAccuracy.total) * 100).toFixed(2)
            : "N/A",
        },
        cacheHits,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

/**
 * Clear all caches (for cleanup)
 */
router.post("/clear-caches", (_req: Request, res: Response) => {
  geohashCache.clear();
  h3Cache.clear();
  quadkeyCache.clear();
  proximityAccuracy = { correct: 0, total: 0 };
  res.json({ ok: true, message: "All caches cleared" });
});

export default router;
