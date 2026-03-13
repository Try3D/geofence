import express, { Request, Response } from "express";
import Redis from "ioredis";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import { parseCoordinate, parseTable } from "../utils/validators";
import { pool } from "../db";

const router = express.Router();

const redis = new Redis({ host: "localhost", port: 6379 });

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cacheKey(lat: number, lon: number, precision: number): string {
  return `geofence:${lat.toFixed(precision)}:${lon.toFixed(precision)}`;
}

async function findClosestCachedEntry(
  lat: number,
  lon: number,
  maxDistanceM: number
): Promise<{ polygonIds: string[]; distanceM: number } | null> {
  const keys = await redis.keys("geofence:*:*");
  let closest: { distance: number; polygonIds: string[] } | null = null;

  for (const key of keys) {
    const parts = key.split(":");
    if (parts.length !== 3) continue;
    const cachedLat = parseFloat(parts[1]);
    const cachedLon = parseFloat(parts[2]);
    const dist = haversineDistance(lat, lon, cachedLat, cachedLon);
    if (dist <= maxDistanceM && (!closest || dist < closest.distance)) {
      const cached = await redis.get(key);
      if (cached) closest = { distance: dist, polygonIds: JSON.parse(cached) };
    }
  }

  return closest
    ? { polygonIds: closest.polygonIds, distanceM: Math.round(closest.distance) }
    : null;
}

async function queryDb(table: string, lat: number, lon: number) {
  const result = await pool.query(
    `SELECT DISTINCT p.osm_id::text
     FROM ${table} p
     WHERE ST_Covers(p.way, ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857))
     LIMIT 1000`,
    [lon, lat]
  );
  return result.rows.map((r: any) => r.osm_id as string);
}

/**
 * POST /exp/06/no-cache — single point, direct DB query
 * Body: { lat, lon, table? }
 */
router.post(
  "/no-cache",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { lat: latRaw, lon: lonRaw, table: tableRaw } = req.body;
      const lat = parseCoordinate(latRaw, "lat");
      const lon = parseCoordinate(lonRaw, "lon");
      const table = parseTable(tableRaw);

      const t0 = performance.now();
      const polygonIds = await queryDb(table, lat, lon);
      const latencyMs = performance.now() - t0;

      res.json({ lat, lon, polygonIds, source: "db", latencyMs: latencyMs.toFixed(2) });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  })
);

/**
 * Proximity cache route factory — single point
 * Body: { lat, lon, table? }
 */
function createProximityCacheRoute(radiusM: number, precision: number) {
  return asyncHandler(async (req: Request, res: Response) => {
    try {
      const { lat: latRaw, lon: lonRaw, table: tableRaw } = req.body;
      const lat = parseCoordinate(latRaw, "lat");
      const lon = parseCoordinate(lonRaw, "lon");
      const table = parseTable(tableRaw);

      const t0 = performance.now();
      const cached = await findClosestCachedEntry(lat, lon, radiusM);

      if (cached) {
        const latencyMs = performance.now() - t0;
        return res.json({
          lat,
          lon,
          polygonIds: cached.polygonIds,
          source: "cache",
          distanceM: cached.distanceM,
          latencyMs: latencyMs.toFixed(2),
        });
      }

      // Cache miss: query DB then store
      const polygonIds = await queryDb(table, lat, lon);
      const latencyMs = performance.now() - t0;

      const key = cacheKey(lat, lon, precision);
      await redis.setex(key, 3600, JSON.stringify(polygonIds));

      res.json({ lat, lon, polygonIds, source: "db", latencyMs: latencyMs.toFixed(2) });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  });
}

router.post("/cache-1km", createProximityCacheRoute(1000, 3));
router.post("/cache-2km", createProximityCacheRoute(2000, 3));
router.post("/cache-5km", createProximityCacheRoute(5000, 2));
router.post("/cache-10km", createProximityCacheRoute(10000, 2));

router.post("/flush", asyncHandler(async (_req: Request, res: Response) => {
  await redis.flushdb();
  res.json({ ok: true });
}));

export default router;
