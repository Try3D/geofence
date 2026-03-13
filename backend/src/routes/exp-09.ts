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

// Status endpoint: returns current JIT configuration
router.get(
  "/status",
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const result = await pool.query("SHOW jit");
      const jitStatus = result.rows[0]?.jit || "unknown";
      res.json({
        jit: jitStatus,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

// Toggle JIT endpoint: changes PostgreSQL JIT setting and reloads config
router.post(
  "/toggle-jit",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { jit } = req.body as { jit?: boolean };
      const jitValue = jit === false ? "off" : "on";

      // Set JIT configuration
      await pool.query(`ALTER SYSTEM SET jit = ${jitValue}`);

      // Reload PostgreSQL configuration
      await pool.query("SELECT pg_reload_conf()");

      // Verify the change took effect
      const result = await pool.query("SHOW jit");
      const newJitStatus = result.rows[0]?.jit || "unknown";

      res.json({
        success: true,
        jit: newJitStatus,
        message: `JIT set to ${jitValue}`,
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

export default router;
