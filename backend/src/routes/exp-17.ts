import express, { Request, Response } from "express";
import { asyncHandler, formatError } from "../utils/errorHandler";
import { pool } from "../db";

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

function makeBatchQuery(column: string): string {
  return `
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
        ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY hb.depth DESC, hb.admin_level DESC, hb.id) as rn
      FROM pts
      JOIN hierarchy_boundaries hb ON ST_Contains(hb.${column}, pts.g)
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
}

const QUERY_GIST = makeBatchQuery("bounds_4326");
const QUERY_SPGIST = makeBatchQuery("bounds_sp");
const QUERY_BRIN = makeBatchQuery("bounds_brin");

async function runQuery(
  sql: string,
  lons: number[],
  lats: number[],
  totalCount: number
): Promise<HierarchyMatch[]> {
  const result = await pool.query<{
    idx: number;
    hierarchy: HierarchyEntry[];
  }>(sql, [lons, lats]);

  const grouped: Record<number, HierarchyMatch> = {};
  for (let i = 0; i < totalCount; i++) {
    grouped[i] = { idx: i, hierarchy: [] };
  }
  result.rows.forEach((row) => {
    grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy || [] };
  });

  return Object.values(grouped);
}

function makeHandler(sql: string) {
  return asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as { points: unknown };
      if (!Array.isArray(points) || points.length === 0) {
        return void res.status(400).json({ error: "points must be a non-empty array" });
      }
      if (points.length > 5000) {
        return void res.status(400).json({ error: "points array exceeds maximum of 5000" });
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

      const results = await runQuery(sql, lons, lats, points.length);
      res.json({ count: points.length, results });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  });
}

// POST /exp/17/gist — baseline GIST R-tree on bounds_4326
router.post("/gist", makeHandler(QUERY_GIST));

// POST /exp/17/spgist — SP-GiST space-partitioning index on bounds_sp
router.post("/spgist", makeHandler(QUERY_SPGIST));

// POST /exp/17/brin — BRIN block-range index on bounds_brin (after CLUSTER)
router.post("/brin", makeHandler(QUERY_BRIN));

export default router;
