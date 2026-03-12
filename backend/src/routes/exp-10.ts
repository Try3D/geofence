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

// Full payload: Current format with osm_id and name
router.post(
  "/full",
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

// Minimal payload: IDs only (no name, no metadata)
router.post(
  "/ids-only",
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
        // Only include osm_id, no name field
        grouped[row.idx].matches.push(row.osm_id);
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

// Optimized ID query: Query excludes name field entirely
// Uses minimal SQL to avoid transmitting unnecessary data
router.post(
  "/ids-optimized",
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

      // Optimized query: No name field, minimal projection
      const query = `
        WITH points AS (
          SELECT (ordinality - 1) AS idx, lon, lat
          FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
        ),
        pts AS (
          SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
          FROM points
        )
        SELECT pts.idx::int,
               match.osm_id
        FROM pts
        CROSS JOIN LATERAL (
          SELECT p.osm_id::text
          FROM ${table} p
          WHERE ST_Covers(p.way, pts.g)
        ) match
      `;

      const result = await pool.query<{ idx: number; osm_id: string }>(query, [
        lons,
        lats,
      ]);

      const grouped: Record<number, any> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, matches: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx].matches.push(row.osm_id);
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
