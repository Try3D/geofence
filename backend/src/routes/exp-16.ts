import express, { Request, Response } from "express";
import { asyncHandler, formatError } from "../utils/errorHandler";
import { pool } from "../db";
import path from "path";
import protobuf from "protobufjs";

// __dirname is available in CommonJS (module: "commonjs")
const PROTO_PATH = path.resolve(
  __dirname,
  "../../../experiments/16_serialization_format/schema.proto"
);

// Load protobuf schema once at module init
let PointBatchType: protobuf.Type;
let BatchResponseType: protobuf.Type;
const protoReady = protobuf.load(PROTO_PATH).then((root) => {
  PointBatchType = root.lookupType("PointBatch");
  BatchResponseType = root.lookupType("BatchResponse");
});

const router = express.Router();

interface HierarchyEntry {
  id: number | null;
  osm_id: number;
  name: string;
  admin_level: number;
  depth: number;
}

interface HierarchyMatch {
  idx: number;
  hierarchy: HierarchyEntry[];
}

// Shared SQL query — ST_Contains, returns deepest boundary per point
const QUERY = `
  WITH points AS (
    SELECT (ordinality - 1) AS idx, lon, lat
    FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
  ),
  pts AS (
    SELECT idx, ST_SetSRID(ST_Point(lon, lat), 4326) AS g
    FROM points
  ),
  deepest_match AS (
    SELECT
      pts.idx,
      hb.id,
      hb.osm_id,
      hb.name,
      hb.admin_level,
      hb.depth,
      ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY hb.depth DESC) as rn
    FROM pts
    JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds_4326, pts.g)
  )
  SELECT
    idx,
    json_build_array(
      json_build_object(
        'id', id,
        'osm_id', osm_id,
        'name', name,
        'admin_level', admin_level,
        'depth', depth
      )
    ) as hierarchy
  FROM deepest_match
  WHERE rn = 1
`;

async function runQuery(
  lons: number[],
  lats: number[],
  totalCount: number
): Promise<HierarchyMatch[]> {
  const result = await pool.query<{
    idx: number;
    hierarchy: HierarchyEntry[];
  }>(QUERY, [lons, lats]);

  const grouped: Record<number, HierarchyMatch> = {};
  for (let i = 0; i < totalCount; i++) {
    grouped[i] = { idx: i, hierarchy: [] };
  }
  result.rows.forEach((row) => {
    grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy || [] };
  });

  return Object.values(grouped);
}

// POST /exp/16/json — standard JSON: {"points": [{lon, lat}, ...]}
router.post(
  "/json",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as { points: unknown };
      if (!Array.isArray(points) || points.length === 0) {
        return void res.status(400).json({ error: "points must be a non-empty array" });
      }
      if (points.length > 1000) {
        return void res.status(400).json({ error: "points array exceeds maximum of 1000" });
      }

      const lons: number[] = [];
      const lats: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i] as { lon?: unknown; lat?: unknown };
        const lon = Number(p?.lon);
        const lat = Number(p?.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
          return void res.status(400).json({ error: `Invalid coordinates at index ${i}` });
        }
        lons.push(lon);
        lats.push(lat);
      }

      const results = await runQuery(lons, lats, points.length);
      res.json({ count: points.length, results });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  })
);

// POST /exp/16/json-flat — compact arrays: {"lons": [...], "lats": [...]}
router.post(
  "/json-flat",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { lons, lats } = req.body as { lons: unknown; lats: unknown };
      if (!Array.isArray(lons) || !Array.isArray(lats)) {
        return void res.status(400).json({ error: "lons and lats must be arrays" });
      }
      if (lons.length === 0) {
        return void res.status(400).json({ error: "lons/lats must be non-empty" });
      }
      if (lons.length !== lats.length) {
        return void res.status(400).json({ error: "lons and lats must have the same length" });
      }
      if (lons.length > 1000) {
        return void res.status(400).json({ error: "exceeds maximum of 1000 points" });
      }

      const results = await runQuery(lons as number[], lats as number[], lons.length);
      res.json({ count: lons.length, results });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  })
);

// POST /exp/16/proto — binary protobuf in, binary protobuf out
router.post(
  "/proto",
  express.raw({ type: "application/x-protobuf", limit: "2mb" }),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      await protoReady;

      const buf = req.body as Buffer;
      const batch = PointBatchType.decode(buf) as unknown as {
        lons: number[];
        lats: number[];
      };

      const { lons, lats } = batch;
      if (!Array.isArray(lons) || !Array.isArray(lats) || lons.length === 0) {
        return void res.status(400).json({ error: "invalid protobuf payload: empty or missing lons/lats" });
      }
      if (lons.length > 1000) {
        return void res.status(400).json({ error: "exceeds maximum of 1000 points" });
      }

      const matches = await runQuery(lons, lats, lons.length);

      const response = BatchResponseType.create({
        count: lons.length,
        results: matches.map((m) => ({
          idx: m.idx,
          hierarchy: m.hierarchy.map((h) => ({
            id: h.id ?? 0,
            osmId: h.osm_id,
            name: h.name,
            adminLevel: h.admin_level,
            depth: h.depth,
          })),
        })),
      });

      const encoded = BatchResponseType.encode(response).finish();
      res.setHeader("Content-Type", "application/x-protobuf");
      res.send(Buffer.from(encoded));
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  })
);

export default router;
