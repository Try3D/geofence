import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { pool } from "../db";

const router = express.Router();

router.get("/", asyncHandler(async (_req: Request, res: Response) => {
  const result = await pool.query<{ now: string }>("SELECT NOW() AS now");
  res.json({ ok: true, dbTime: result.rows[0].now });
}));

export default router;
