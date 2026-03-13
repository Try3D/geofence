import express, { Request, Response } from "express";
import Redis from "ioredis";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import { parseCoordinate, parseTable } from "../utils/validators";
import { pool } from "../db";

const router = express.Router();

// Two Redis clients:
// - redis: GEO index (geofence:geo) + polygon data (geofence:data:<member>)
// - Uses maxmemory-policy allkeys-lru so Redis evicts LRU entries automatically
const redis = new Redis({ host: "localhost", port: 6379 });

// Configure LRU on startup (100MB cap, LRU eviction)
redis.config("SET", "maxmemory", "100mb").catch(() => {});
redis.config("SET", "maxmemory-policy", "allkeys-lru").catch(() => {});

const GEO_KEY = "geofence:geo";

/**
 * Member name encodes lat/lon so we can retrieve it from GEOSEARCH results
 */
function geoMember(lat: number, lon: number): string {
  return `${lat.toFixed(6)}:${lon.toFixed(6)}`;
}

async function findClosestCachedEntry(
  lat: number,
  lon: number,
  radiusM: number
): Promise<{ polygonIds: string[]; distanceM: number } | null> {
  // GEOSEARCH: find nearest cached point within radiusM, return 1 result with distance
  const results = await redis.call(
    "GEOSEARCH",
    GEO_KEY,
    "FROMLONLAT", lon, lat,
    "BYRADIUS", radiusM, "m",
    "ASC",
    "COUNT", 1,
    "WITHDIST"
  ) as any[];

  if (!results || results.length === 0) return null;

  // results[0] = [member, distance] — distance in meters (unit matches BYRADIUS unit)
  const [member, distStr] = results[0];
  const distanceM = Math.round(parseFloat(distStr));

  const dataKey = `geofence:data:${member}`;
  const cached = await redis.get(dataKey);
  if (!cached) return null;

  return { polygonIds: JSON.parse(cached), distanceM };
}

async function storeInCache(lat: number, lon: number, polygonIds: string[]) {
  const member = geoMember(lat, lon);
  const dataKey = `geofence:data:${member}`;

  await Promise.all([
    redis.geoadd(GEO_KEY, lon, lat, member),
    redis.setex(dataKey, 3600, JSON.stringify(polygonIds)),
  ]);
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
 * Proximity cache route factory — uses GEOSEARCH, O(log n)
 */
function createProximityCacheRoute(radiusM: number) {
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
          lat, lon,
          polygonIds: cached.polygonIds,
          source: "cache",
          distanceM: cached.distanceM,
          latencyMs: latencyMs.toFixed(2),
        });
      }

      // Cache miss: query DB then store
      const polygonIds = await queryDb(table, lat, lon);
      const latencyMs = performance.now() - t0;

      await storeInCache(lat, lon, polygonIds);

      res.json({ lat, lon, polygonIds, source: "db", latencyMs: latencyMs.toFixed(2) });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  });
}

router.post("/cache-1km",  createProximityCacheRoute(1000));
router.post("/cache-2km",  createProximityCacheRoute(2000));
router.post("/cache-5km",  createProximityCacheRoute(5000));
router.post("/cache-10km", createProximityCacheRoute(10000));

router.post("/flush", asyncHandler(async (_req: Request, res: Response) => {
  await redis.flushdb();
  res.json({ ok: true });
}));

export default router;
