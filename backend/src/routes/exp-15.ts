import express, { Request, Response } from "express";
import { asyncHandler, formatError } from "../utils/errorHandler";
import { validateBatchPayload, parseCoordinates } from "../utils/validators";
import { pool } from "../db";

const router = express.Router();

interface HierarchyMatch {
  idx: number;
  hierarchy: Array<{
    id: number | null;
    osm_id: number;
    name: string;
    admin_level: number;
    depth: number;
  }>;
}

function mortonCode(lon: number, lat: number): bigint {
  const x = (lon + 180) / 360;
  const y = (lat + 90) / 180;
  const xi = Math.floor(x * (1 << 26));
  const yi = Math.floor(y * (1 << 26));
  let result = 0n;
  for (let i = 0; i < 26; i++) {
    result |= BigInt((xi >> i) & 1) << BigInt(2 * i);
    result |= BigInt((yi >> i) & 1) << BigInt(2 * i + 1);
  }
  return result;
}

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

// Baseline: points in arrival order
router.post(
  "/unsorted",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as { points: unknown };
      validateBatchPayload(points, 5000);
      const { lons, lats } = parseCoordinates(points);

      const result = await pool.query<{
        idx: number;
        hierarchy: HierarchyMatch["hierarchy"];
      }>(QUERY, [lons, lats]);

      const grouped: Record<number, HierarchyMatch> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, hierarchy: [] };
      }
      result.rows.forEach((row) => {
        grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy || [] };
      });

      res.json({ count: points.length, results: Object.values(grouped) });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  })
);

// Geohash-sorted: points sorted by Morton code for spatial cache locality
router.post(
  "/geohash-sorted",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as { points: unknown };
      validateBatchPayload(points, 5000);
      const parsed = points as Array<{ lon: number; lat: number }>;

      // Build sorted order by Morton code
      const sortedIndices = Array.from({ length: parsed.length }, (_, i) => i);
      sortedIndices.sort((a, b) => {
        const ma = mortonCode(parsed[a].lon, parsed[a].lat);
        const mb = mortonCode(parsed[b].lon, parsed[b].lat);
        return ma < mb ? -1 : ma > mb ? 1 : 0;
      });

      // Build lons/lats in sorted order; track sortedPos -> originalIdx
      const lons: number[] = new Array(parsed.length);
      const lats: number[] = new Array(parsed.length);
      const originalIdx: number[] = new Array(parsed.length);
      for (let sortedPos = 0; sortedPos < sortedIndices.length; sortedPos++) {
        const orig = sortedIndices[sortedPos];
        lons[sortedPos] = parsed[orig].lon;
        lats[sortedPos] = parsed[orig].lat;
        originalIdx[sortedPos] = orig;
      }

      const result = await pool.query<{
        idx: number;
        hierarchy: HierarchyMatch["hierarchy"];
      }>(QUERY, [lons, lats]);

      // Pre-fill with empty results keyed by original index
      const grouped: Record<number, HierarchyMatch> = {};
      for (let i = 0; i < parsed.length; i++) {
        grouped[i] = { idx: i, hierarchy: [] };
      }

      // Map sorted position back to original index
      result.rows.forEach((row) => {
        const orig = originalIdx[row.idx];
        grouped[orig] = { idx: orig, hierarchy: row.hierarchy || [] };
      });

      res.json({ count: parsed.length, results: Object.values(grouped) });
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  })
);

export default router;
