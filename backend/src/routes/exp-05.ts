import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
  parsePositiveInt,
  parseTable,
} from "../utils/validators";
import { getLateralBatchQuery, getJsonBatchQuery } from "../queries/batch";
import { BatchResult, JsonBatchResult } from "../types";
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
      parsePositiveInt(limitRaw, 20); // Parse but don't use (for consistency with JSON/temp)

      const query = getLateralBatchQuery(table);
      const result = await pool.query<BatchResult>(query, [lons, lats]);

      // Normalize response: group flat results into {idx, matches} format
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

// JSON expansion batch: expand points via unnest with aggregation for all matches per point
router.post(
  "/batch-json",
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
      // Note: limit param is unused for JSON expansion (returns all matches)
      parsePositiveInt(limitRaw, 20);

      const query = getJsonBatchQuery(table);
      const result = await pool.query<JsonBatchResult>(query, [lons, lats]);

      // Normalize response: include all input points, with empty arrays for zero-match points
      const indexedResults = new Map(result.rows.map((r) => [r.idx, r.matches]));
      const normalizedResults = Array.from({ length: points.length }, (_, i) => ({
        idx: i,
        matches: indexedResults.get(i) || [],
      }));

      res.json({
        count: points.length,
        results: normalizedResults,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

// Temp table batch: load points into temp table and perform set-based spatial join
router.post(
  "/batch-temp",
  asyncHandler(async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const { points, limit: limitRaw, table: tableRaw } = req.body as {
        points: unknown;
        limit?: unknown;
        table?: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);
      const table = parseTable(tableRaw);
      // Note: limit param is unused for temp table (returns all matches)
      parsePositiveInt(limitRaw, 20);

      // Begin transaction for temp table
      await client.query("BEGIN TRANSACTION");

      // Create temp table for points
      await client.query(`
        CREATE TEMP TABLE batch_points (
          idx INT,
          geom GEOMETRY
        ) ON COMMIT DROP
      `);

      // Bulk insert points into temp table
      const insertQuery = `
        INSERT INTO batch_points (idx, geom)
        SELECT ordinality - 1 AS idx,
               ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS geom
        FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
      `;
      await client.query(insertQuery, [lons, lats]);

      // Add index for larger batches
      if (points.length > 100) {
        await client.query(
          "CREATE INDEX idx_batch_points_geom ON batch_points USING GIST(geom)"
        );
      }

      // Perform set-based spatial join with aggregation
      const joinQuery = `
        SELECT bp.idx::int,
               COALESCE(
                 array_agg(
                   json_build_object('osm_id', p.osm_id::text, 'name', COALESCE(p.name, p.tags->'name'))
                   ORDER BY p.osm_id
                 ) FILTER (WHERE p.osm_id IS NOT NULL),
                 '{}'::json[]
               ) AS matches
        FROM batch_points bp
        LEFT JOIN ${table} p ON ST_Covers(p.way, bp.geom)
        GROUP BY bp.idx
        ORDER BY bp.idx
      `;
      const result = await client.query<JsonBatchResult>(joinQuery);

      // Commit transaction (temp table auto-drops)
      await client.query("COMMIT");

      // Normalize response: include all input points, with empty arrays for zero-match points
      const indexedResults = new Map(result.rows.map((r) => [r.idx, r.matches]));
      const normalizedResults = Array.from({ length: points.length }, (_, i) => ({
        idx: i,
        matches: indexedResults.get(i) || [],
      }));

      res.json({
        count: points.length,
        results: normalizedResults,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const message = formatError(error);
      res.status(400).json({ error: message });
    } finally {
      client.release();
    }
  })
);

export default router;
