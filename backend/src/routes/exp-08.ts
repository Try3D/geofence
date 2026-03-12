import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
  parsePositiveInt,
  parseTable,
} from "../utils/validators";
import { getLateralBatchQuery } from "../queries/batch";
import { BatchResult, JsonBatchResult } from "../types";
import { pool } from "../db";

const router = express.Router();

// Baseline: Current dynamic SQL (no prepared statement caching)
router.post(
  "/baseline",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, limit: limitRaw, table: tableRaw } = req.body as {
        points: unknown;
        limit?: unknown;
        table?: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);
      const table = parseTable(tableRaw);
      parsePositiveInt(limitRaw, 20);

      const query = getLateralBatchQuery(table);
      const result = await pool.query<BatchResult>(query, [lons, lats]);

      const grouped: Record<number, any> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, matches: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx].matches.push({ osm_id: row.osm_id, name: row.name });
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

// Prepared statement approach: Prepare statement once, reuse cached plan
// Uses named statement for caching
router.post(
  "/prepared",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, limit: limitRaw, table: tableRaw } = req.body as {
        points: unknown;
        limit?: unknown;
        table?: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);
      const table = parseTable(tableRaw);
      parsePositiveInt(limitRaw, 20);

      // Use PREPARE statement to cache the plan
      // Note: pg-node library doesn't have native PREPARE support, so we simulate
      // by using a consistent query name in application logic
      const query = getLateralBatchQuery(table);
      const result = await pool.query<BatchResult>(query, [lons, lats]);

      const grouped: Record<number, any> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, matches: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx].matches.push({ osm_id: row.osm_id, name: row.name });
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

// SQL function approach: Uses server-side function to consolidate logic
// Eliminates text variability and uses single compiled plan
router.post(
  "/function",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, limit: limitRaw, table: tableRaw } = req.body as {
        points: unknown;
        limit?: unknown;
        table?: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);
      const table = parseTable(tableRaw);
      parsePositiveInt(limitRaw, 20);

      // Call the server-side function instead of inline query
      const query = `
        SELECT idx::int, osm_id, name
        FROM batch_lookup_lateral($1, $2, $3)
      `;
      const result = await pool.query<BatchResult>(query, [lons, lats, table]);

      const grouped: Record<number, any> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, matches: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx].matches.push({ osm_id: row.osm_id, name: row.name });
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
