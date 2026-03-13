import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
} from "../utils/validators";
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

// BASELINE: Transform to 3857, use bounds column (same as exp-11 normal)
router.post(
  "/baseline",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as {
        points: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);

      const query = `
        WITH points AS (
          SELECT (ordinality - 1) AS idx, lon, lat
          FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
        ),
        pts AS (
          SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
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
          JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds, pts.g)
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

      const result = await pool.query<{
        idx: number;
        hierarchy: Array<{
          id: number;
          osm_id: number;
          name: string;
          admin_level: number;
          depth: number;
        }>;
      }>(query, [lons, lats]);

      const grouped: Record<number, HierarchyMatch> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, hierarchy: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy || [] };
      });

      res.json({
        count: points.length,
        results: Object.values(grouped),
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

// NATIVE: Use 4326 directly, no transform, use bounds_4326 column
router.post(
  "/native",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as {
        points: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);

      const query = `
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

      const result = await pool.query<{
        idx: number;
        hierarchy: Array<{
          id: number;
          osm_id: number;
          name: string;
          admin_level: number;
          depth: number;
        }>;
      }>(query, [lons, lats]);

      const grouped: Record<number, HierarchyMatch> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, hierarchy: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy || [] };
      });

      res.json({
        count: points.length,
        results: Object.values(grouped),
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

export default router;
