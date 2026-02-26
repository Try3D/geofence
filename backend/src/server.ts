import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { pool } from "./db";

type ContainsItem = {
  osm_id: string;
  name: string | null;
};

type NearbyItem = ContainsItem & {
  distance_m: number;
};

const app = express();
const port = Number(process.env.PORT || 3000);

function parseCoordinate(value: unknown, label: "lon" | "lat"): number {
  if (value === undefined) {
    throw new Error(`Missing query param: ${label}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: must be a number`);
  }
  return parsed;
}

function parsePositiveInt(value: unknown, fallback: number, max = 500): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid limit: must be a positive integer");
  }
  return Math.min(parsed, max);
}

app.get("/health", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query<{ now: string }>("SELECT NOW() AS now");
    res.json({ ok: true, dbTime: result.rows[0].now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/polygons/contains", async (req: Request, res: Response) => {
  try {
    const lon = parseCoordinate(req.query.lon, "lon");
    const lat = parseCoordinate(req.query.lat, "lat");
    const limit = parsePositiveInt(req.query.limit, 200);

    const query = `
      WITH pt AS (
        SELECT ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857) AS g
      )
      SELECT p.osm_id::text,
             COALESCE(p.name, p.tags->'name') AS name
      FROM planet_osm_polygon p, pt
      WHERE ST_Covers(p.way, pt.g)
      LIMIT $3
    `;

    const result = await pool.query<ContainsItem>(query, [lon, lat, limit]);
    res.json({
      lon,
      lat,
      count: result.rowCount,
      items: result.rows
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

app.get("/api/polygons/nearby", async (req: Request, res: Response) => {
  try {
    const lon = parseCoordinate(req.query.lon, "lon");
    const lat = parseCoordinate(req.query.lat, "lat");
    const radiusMeters = Number(req.query.radius_m || 1000);
    const limit = parsePositiveInt(req.query.limit, 100);

    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      throw new Error("Invalid radius_m: must be a positive number");
    }

    const query = `
      WITH pt AS (
        SELECT ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857) AS g
      )
      SELECT p.osm_id::text,
             COALESCE(p.name, p.tags->'name') AS name,
             ST_Distance(p.way, pt.g) AS distance_m
      FROM planet_osm_polygon p, pt
      WHERE ST_DWithin(p.way, pt.g, $3)
      ORDER BY p.way <-> pt.g
      LIMIT $4
    `;

    const result = await pool.query<NearbyItem>(query, [lon, lat, radiusMeters, limit]);
    res.json({
      lon,
      lat,
      radius_m: radiusMeters,
      count: result.rowCount,
      items: result.rows
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Unexpected server error";
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
