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
import { BatchResult } from "../types";
import { pool } from "../db";

const router = express.Router();

// JIT impact test endpoint: runs the batch lookup query
// The JIT configuration is toggled externally via PostgreSQL settings
router.post(
  "/lookup",
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

// Status endpoint: returns current JIT configuration (for logging)
router.get(
  "/status",
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        "SHOW jit; SHOW jit_above_cost; SHOW jit_inline_above_cost;"
      );
      res.json({
        jit_config: result.rows,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

export default router;
