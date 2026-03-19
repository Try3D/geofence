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

// ST_CONTAINS: false if point is exactly on boundary
router.post(
  "/contains",
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

// ST_COVERS: true if point is on boundary (semantically correct for admin boundaries)
router.post(
  "/covers",
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
          JOIN hierarchy_boundaries hb ON ST_Covers(hb.bounds_4326, pts.g)
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
