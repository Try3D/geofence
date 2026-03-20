import express, { Request, Response } from "express";
import { Pool } from "pg";
import { asyncHandler, formatError } from "../utils/errorHandler";
import { validateBatchPayload, parseCoordinates, parseCoordinate } from "../utils/validators";

const router = express.Router();

// Exp-01: dedicated pool with max=15
const pool18 = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 6432),
  user: process.env.PGUSER || "gis",
  password: process.env.PGPASSWORD || "gis",
  database: process.env.PGDATABASE || "gis",
  max: 15,
});

// Exp-09: disable JIT on every new connection
pool18.on("connect", (client) => {
  client.query("SET jit = off").catch(console.error);
});

const CHUNK_SIZE = 100; // Exp-03

// ─── SQL ────────────────────────────────────────────────────────────────────
//
// Key insight from Exp-12/14: hierarchy_boundaries has bounds_4326 (GIST-indexed, 4326).
// Querying it with a 4326 point (no ST_Transform) is 3× faster than transforming to 3857.
// planet_osm_polygon_simple_10.way is 3857, so the fallback DOES need ST_Transform.

// Single — hierarchy pass (ids only)
// Exp-12/14: bounds_4326 + no transform | Exp-07: bbox && | Exp-14: ST_Contains | Exp-10: ids-only
const SINGLE_HIER_IDS = `
  WITH pt AS (SELECT ST_SetSRID(ST_Point($1, $2), 4326) AS g)
  SELECT hb.osm_id::text
  FROM hierarchy_boundaries hb, pt
  WHERE hb.bounds_4326 && pt.g AND ST_Contains(hb.bounds_4326, pt.g)
  ORDER BY hb.depth DESC
`;

const SINGLE_HIER_FULL = `
  WITH pt AS (SELECT ST_SetSRID(ST_Point($1, $2), 4326) AS g)
  SELECT hb.osm_id::text, hb.name
  FROM hierarchy_boundaries hb, pt
  WHERE hb.bounds_4326 && pt.g AND ST_Contains(hb.bounds_4326, pt.g)
  ORDER BY hb.depth DESC
`;

// Single — fallback to simple_10 (way is 3857, transform required)
// Exp-04: simple_10 | Exp-07: bbox | Exp-14: ST_Contains
const SINGLE_FALLBACK_IDS = `
  WITH pt AS (SELECT ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857) AS g)
  SELECT p.osm_id::text
  FROM planet_osm_polygon_simple_10 p, pt
  WHERE p.way && pt.g AND ST_Contains(p.way, pt.g)
`;

const SINGLE_FALLBACK_FULL = `
  WITH pt AS (SELECT ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857) AS g)
  SELECT p.osm_id::text, COALESCE(p.name, p.tags->>'name') AS name
  FROM planet_osm_polygon_simple_10 p, pt
  WHERE p.way && pt.g AND ST_Contains(p.way, pt.g)
`;

// Batch — hierarchy pass (ids only)
// Exp-05: unnest+ordinality | Exp-11: hierarchy_boundaries | NULL matches = miss for fallback
const BATCH_HIER_IDS = `
  SELECT (pts.ordinality - 1)::int AS idx,
         array_agg(hb.osm_id::text ORDER BY hb.depth DESC)
           FILTER (WHERE hb.osm_id IS NOT NULL) AS matches
  FROM (
    SELECT ordinality, ST_SetSRID(ST_Point(lon, lat), 4326) AS g
    FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
  ) pts
  LEFT JOIN hierarchy_boundaries hb ON (hb.bounds_4326 && pts.g) AND ST_Contains(hb.bounds_4326, pts.g)
  GROUP BY pts.ordinality ORDER BY pts.ordinality
`;

const BATCH_HIER_FULL = `
  SELECT (pts.ordinality - 1)::int AS idx,
         array_agg(
           json_build_object('osm_id', hb.osm_id::text, 'name', hb.name)
           ORDER BY hb.depth DESC
         ) FILTER (WHERE hb.osm_id IS NOT NULL) AS matches
  FROM (
    SELECT ordinality, ST_SetSRID(ST_Point(lon, lat), 4326) AS g
    FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
  ) pts
  LEFT JOIN hierarchy_boundaries hb ON (hb.bounds_4326 && pts.g) AND ST_Contains(hb.bounds_4326, pts.g)
  GROUP BY pts.ordinality ORDER BY pts.ordinality
`;

// Batch — fallback pass against simple_10 (way is 3857, transform required)
// Exp-03: chunked parallel | Exp-04: simple_10
const BATCH_FALLBACK_IDS = `
  SELECT (pts.ordinality - 1)::int AS idx,
         array_agg(p.osm_id::text ORDER BY p.osm_id)
           FILTER (WHERE p.osm_id IS NOT NULL) AS matches
  FROM (
    SELECT ordinality, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
    FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
  ) pts
  LEFT JOIN planet_osm_polygon_simple_10 p ON (p.way && pts.g) AND ST_Contains(p.way, pts.g)
  GROUP BY pts.ordinality ORDER BY pts.ordinality
`;

const BATCH_FALLBACK_FULL = `
  SELECT (pts.ordinality - 1)::int AS idx,
         array_agg(
           json_build_object('osm_id', p.osm_id::text, 'name', COALESCE(p.name, p.tags->>'name'))
           ORDER BY p.osm_id
         ) FILTER (WHERE p.osm_id IS NOT NULL) AS matches
  FROM (
    SELECT ordinality, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
    FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
  ) pts
  LEFT JOIN planet_osm_polygon_simple_10 p ON (p.way && pts.g) AND ST_Contains(p.way, pts.g)
  GROUP BY pts.ordinality ORDER BY pts.ordinality
`;

// ─── Fallback helper ─────────────────────────────────────────────────────────

async function runFallback(
  missIndices: number[],
  lons: number[],
  lats: number[],
  sql: string
): Promise<Map<number, unknown>> {
  const resultMap = new Map<number, unknown>();

  // Exp-03: Promise.all chunking, CHUNK_SIZE = 100
  const chunks: Promise<void>[] = [];
  for (let offset = 0; offset < missIndices.length; offset += CHUNK_SIZE) {
    const chunkIndices = missIndices.slice(offset, offset + CHUNK_SIZE);
    const chunkLons = chunkIndices.map((i) => lons[i]);
    const chunkLats = chunkIndices.map((i) => lats[i]);

    chunks.push(
      pool18.query(sql, [chunkLons, chunkLats]).then((res) => {
        for (const row of res.rows) {
          const globalIdx = chunkIndices[row.idx];
          resultMap.set(globalIdx, row.matches);
        }
      })
    );
  }

  await Promise.all(chunks);
  return resultMap;
}

// ─── POST /exp/18/single ─────────────────────────────────────────────────────

router.post(
  "/single",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const lon = parseCoordinate(req.body?.lon, "lon");
      const lat = parseCoordinate(req.body?.lat, "lat");
      const full = req.query.full === "true";

      const hierResult = await pool18.query(
        full ? SINGLE_HIER_FULL : SINGLE_HIER_IDS,
        [lon, lat]
      );

      if (hierResult.rows.length > 0) {
        const matches = full
          ? hierResult.rows.map((r) => ({ osm_id: r.osm_id, name: r.name }))
          : hierResult.rows.map((r) => r.osm_id);
        return void res.json({ matches, source: "hierarchy" });
      }

      const fallbackResult = await pool18.query(
        full ? SINGLE_FALLBACK_FULL : SINGLE_FALLBACK_IDS,
        [lon, lat]
      );
      const matches = full
        ? fallbackResult.rows.map((r) => ({ osm_id: r.osm_id, name: r.name }))
        : fallbackResult.rows.map((r) => r.osm_id);
      return void res.json({ matches, source: "fallback" });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  })
);

// ─── POST /exp/18/batch ──────────────────────────────────────────────────────

router.post(
  "/batch",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as { points: unknown };
      validateBatchPayload(points, 1000);
      const { lons, lats } = parseCoordinates(points as unknown[]);
      const full = req.query.full === "true";

      // Pass 1: hierarchy — single query all points, NULL matches = miss
      const hierResult = await pool18.query(
        full ? BATCH_HIER_FULL : BATCH_HIER_IDS,
        [lons, lats]
      );

      const matched = new Map<number, unknown>();
      const missIndices: number[] = [];

      for (const row of hierResult.rows) {
        if (row.matches !== null) {
          matched.set(row.idx, row.matches);
        } else {
          missIndices.push(row.idx);
        }
      }

      // Pass 2: fallback for misses — chunked parallel against simple_10
      if (missIndices.length > 0) {
        const fallbackMap = await runFallback(
          missIndices,
          lons,
          lats,
          full ? BATCH_FALLBACK_FULL : BATCH_FALLBACK_IDS
        );
        for (const [idx, matches] of fallbackMap) {
          matched.set(idx, matches ?? []);
        }
      }

      const results = Array.from({ length: lons.length }, (_, i) => ({
        idx: i,
        matches: matched.get(i) ?? [],
      }));

      res.json({ count: lons.length, results });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  })
);

export default router;
