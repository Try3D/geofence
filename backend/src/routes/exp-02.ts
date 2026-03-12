import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  parseCoordinate,
  parsePositiveInt,
  parseTable,
  validateBatchPayload,
  parseCoordinates,
} from "../utils/validators";
import { getContainsQuery } from "../queries/contains";
import { getLateralBatchQuery } from "../queries/batch";
import { ContainsItem, BatchResult } from "../types";
import { pool } from "../db";

const router = express.Router();

router.get(
  "/contains",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const lon = parseCoordinate(req.query.lon, "lon");
      const lat = parseCoordinate(req.query.lat, "lat");
      const limit = parsePositiveInt(req.query.limit, 200);
      const table = parseTable(req.query.table);

      const query = getContainsQuery(table);
      const result = await pool.query<ContainsItem>(query, [lon, lat, limit]);

      res.json({
        lon,
        lat,
        count: result.rowCount,
        items: result.rows,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

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
