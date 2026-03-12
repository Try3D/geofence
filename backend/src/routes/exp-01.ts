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

router.post(
  "/batch",
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
      const limit = parsePositiveInt(limitRaw, 20);

      const query = getLateralBatchQuery(table);
      const result = await pool.query<BatchResult>(query, [lons, lats, limit]);

      res.json({
        count: points.length,
        results: result.rows,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

export default router;
