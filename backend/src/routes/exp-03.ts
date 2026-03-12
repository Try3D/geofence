import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
  parsePositiveInt,
  parseTable,
} from "../utils/validators";
import {
  getLateralBatchQuery,
  getParallelBatchQuery,
  getSetBatchQuery,
} from "../queries/batch";
import { BatchResult } from "../types";
import { pool } from "../db";

const router = express.Router();

// Serial LATERAL baseline
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

// Parallel-chunked batch: splits points across pool connections via Promise.all
router.post(
  "/batch-parallel",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, limit: limitRaw, chunkSize: chunkSizeRaw } = req.body as {
        points: unknown;
        limit?: unknown;
        chunkSize?: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);
      const limit = parsePositiveInt(limitRaw, 20);

      const POOL_MAX = 15;
      const chunkSize = chunkSizeRaw
        ? parsePositiveInt(chunkSizeRaw, POOL_MAX, 1000)
        : Math.max(1, Math.ceil(points.length / POOL_MAX));

      const query = getLateralBatchQuery("planet_osm_polygon");

      const chunks: Array<{ cLons: number[]; cLats: number[]; offset: number }> = [];
      for (let i = 0; i < lons.length; i += chunkSize) {
        chunks.push({
          cLons: lons.slice(i, i + chunkSize),
          cLats: lats.slice(i, i + chunkSize),
          offset: i,
        });
      }

      const chunkResults = await Promise.all(
        chunks.map(({ cLons, cLats, offset }) =>
          pool
            .query<BatchResult>(query, [cLons, cLats, limit])
            .then((r) => r.rows.map((row) => ({ ...row, idx: offset + row.idx })))
        )
      );

      res.json({
        count: points.length,
        chunks: chunks.length,
        results: chunkResults.flat(),
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

// Set-join batch: no LATERAL, direct spatial join — allows PG parallel workers
router.post(
  "/batch-set",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points, limit: limitRaw } = req.body as {
        points: unknown;
        limit?: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);
      const limit = parsePositiveInt(limitRaw, 20);

      const query = getSetBatchQuery();
      const result = await pool.query<BatchResult>(query, [
        lons,
        lats,
        limit * points.length,
      ]);

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
