import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
  parseTable,
} from "../utils/validators";
import {
  getJsonBatchQueryNoBbox,
  getJsonBatchQueryWithBbox,
  getJsonBatchQueryWithBboxIndexed,
} from "../queries/bbox-filter";
import { pool } from "../db";

const router = express.Router();

/**
 * POST /exp/07/batch-no-bbox
 * Baseline: JSON batch without explicit bounding box filter
 */
router.post(
  "/batch-no-bbox",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, table: tableRaw } = req.body as {
        points: unknown;
        table?: string;
      };

      validateBatchPayload(points);
      const table = parseTable(tableRaw);
      const { lons, lats } = parseCoordinates(points as any[]);

      const query = getJsonBatchQueryNoBbox(table);
      const result = await pool.query(query, [lons, lats]);

      const results = result.rows.map((row: any) => ({
        idx: row.idx,
        matches: row.matches.map((m: any) => ({
          osm_id: m.osm_id,
          name: m.name,
        })),
      }));

      res.json({
        count: results.length,
        results,
        variant: "no-bbox (baseline)",
      });
    } catch (err) {
      throw err;
    }
  })
);

/**
 * POST /exp/07/batch-with-bbox
 * Optimized: JSON batch with explicit bounding box filter (way && point)
 */
router.post(
  "/batch-with-bbox",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, table: tableRaw } = req.body as {
        points: unknown;
        table?: string;
      };

      validateBatchPayload(points);
      const table = parseTable(tableRaw);
      const { lons, lats } = parseCoordinates(points as any[]);

      const query = getJsonBatchQueryWithBbox(table);
      const result = await pool.query(query, [lons, lats]);

      const results = result.rows.map((row: any) => ({
        idx: row.idx,
        matches: row.matches.map((m: any) => ({
          osm_id: m.osm_id,
          name: m.name,
        })),
      }));

      res.json({
        count: results.length,
        results,
        variant: "with-bbox (simple)",
      });
    } catch (err) {
      throw err;
    }
  })
);

/**
 * POST /exp/07/batch-with-bbox-indexed
 * Optimized: JSON batch with explicit bbox filter using reconstructed point in SRID 4326
 */
router.post(
  "/batch-with-bbox-indexed",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, table: tableRaw } = req.body as {
        points: unknown;
        table?: string;
      };

      validateBatchPayload(points);
      const table = parseTable(tableRaw);
      const { lons, lats } = parseCoordinates(points as any[]);

      const query = getJsonBatchQueryWithBboxIndexed(table);
      const result = await pool.query(query, [lons, lats]);

      const results = result.rows.map((row: any) => ({
        idx: row.idx,
        matches: row.matches.map((m: any) => ({
          osm_id: m.osm_id,
          name: m.name,
        })),
      }));

      res.json({
        count: results.length,
        results,
        variant: "with-bbox-indexed (reconstructed)",
      });
    } catch (err) {
      throw err;
    }
  })
);

export default router;
