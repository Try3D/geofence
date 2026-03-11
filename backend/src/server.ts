import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { pool } from "./db";

type ContainsItem = {
  osm_id: string;
  name: string | null;
};

type NearbyItem = ContainsItem & {
  distance_m: number;
};

const app = express();
app.use(express.json({ limit: "2mb" }));
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

const ALLOWED_TABLES = new Set([
  "planet_osm_polygon",
  "planet_osm_polygon_simple_10",
  "planet_osm_polygon_simple_100",
  "planet_osm_polygon_simple_500",
  "planet_osm_polygon_simple_1000",
]);

function parseTable(value: unknown): string {
  if (value === undefined || value === "original") return "planet_osm_polygon";
  if (typeof value !== "string" || !ALLOWED_TABLES.has(value)) {
    throw new Error(`Invalid table. Allowed: original, simple_10, simple_100, simple_500, simple_1000`);
  }
  return value;
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

function parseCoordinates(points: unknown[]): { lons: number[]; lats: number[] } {
  const lons: number[] = [];
  const lats: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as { lon?: unknown; lat?: unknown };
    const lon = Number(p?.lon);
    const lat = Number(p?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`Invalid coordinates at index ${i}`);
    }
    lons.push(lon);
    lats.push(lat);
  }
  return { lons, lats };
}

function getLateralBatchQuery(table: string): string {
  return `
    WITH points AS (
      SELECT ordinality AS idx, lon, lat
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    ),
    pts AS (
      SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM points
    )
    SELECT pts.idx::int,
           match.osm_id,
           match.name
    FROM pts
    CROSS JOIN LATERAL (
      SELECT p.osm_id::text,
             COALESCE(p.name, p.tags->'name') AS name
      FROM ${table} p
      WHERE ST_Covers(p.way, pts.g)
      LIMIT $3
    ) match
  `;
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
    const table = parseTable(req.query.table);

    const query = `
      WITH pt AS (
        SELECT ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857) AS g
      )
      SELECT p.osm_id::text,
             COALESCE(p.name, p.tags->'name') AS name
      FROM ${table} p, pt
      WHERE ST_Covers(p.way, pt.g)
      LIMIT $3
    `;

    const result = await pool.query<ContainsItem>(query, [lon, lat, limit]);
    res.json({
      lon,
      lat,
      count: result.rowCount,
      items: result.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

app.post("/api/polygons/batch", async (req: Request, res: Response) => {
  try {
    const { points, limit: limitRaw, table: tableRaw } = req.body as {
      points: unknown;
      limit?: unknown;
      table?: unknown;
    };
    const table = parseTable(tableRaw);

    if (!Array.isArray(points) || points.length === 0) {
      throw new Error("points must be a non-empty array");
    }
    if (points.length > 1000) {
      throw new Error("points array exceeds maximum of 1000");
    }

    const { lons, lats } = parseCoordinates(points);
    const limit = parsePositiveInt(limitRaw, 20);

    const query = getLateralBatchQuery(table);

    const result = await pool.query<{ idx: number; osm_id: string; name: string | null }>(
      query,
      [lons, lats, limit]
    );

    res.json({
      count: points.length,
      results: result.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

// Parallel-chunked batch: splits points across pool connections via Promise.all
app.post("/api/polygons/batch-parallel", async (req: Request, res: Response) => {
  try {
    const { points, limit: limitRaw, chunkSize: chunkSizeRaw } = req.body as {
      points: unknown;
      limit?: unknown;
      chunkSize?: unknown;
    };

    if (!Array.isArray(points) || points.length === 0) {
      throw new Error("points must be a non-empty array");
    }
    if (points.length > 1000) {
      throw new Error("points array exceeds maximum of 1000");
    }

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
          .query<{ idx: number; osm_id: string; name: string | null }>(query, [cLons, cLats, limit])
          .then((r) => r.rows.map((row) => ({ ...row, idx: offset + row.idx })))
      )
    );

    res.json({
      count: points.length,
      chunks: chunks.length,
      results: chunkResults.flat(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

// Set-join batch: no LATERAL, direct spatial join — allows PG parallel workers
app.post("/api/polygons/batch-set", async (req: Request, res: Response) => {
  try {
    const { points, limit: limitRaw } = req.body as {
      points: unknown;
      limit?: unknown;
    };

    if (!Array.isArray(points) || points.length === 0) {
      throw new Error("points must be a non-empty array");
    }
    if (points.length > 1000) {
      throw new Error("points array exceeds maximum of 1000");
    }

    const { lons, lats } = parseCoordinates(points);

    const limit = parsePositiveInt(limitRaw, 20);

    // Direct JOIN — no per-point LIMIT (unlike LATERAL), applying the limit across all results.
    // This allows PostgreSQL to use parallel workers and merge bitmap scans from the GiST index
    // on all points at once, trading off per-point limiting for planner flexibility.
    // LIMIT is scaled by point count to approximate total result target.
    const query = `
      SELECT pts.idx::int,
             p.osm_id::text,
             COALESCE(p.name, p.tags->'name') AS name
      FROM (
        SELECT ordinality AS idx,
               ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
        FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
      ) pts
      JOIN planet_osm_polygon p ON ST_Covers(p.way, pts.g)
      LIMIT $3
    `;

    const result = await pool.query<{ idx: number; osm_id: string; name: string | null }>(
      query,
      [lons, lats, limit * points.length]
    );

    res.json({
      count: points.length,
      results: result.rows,
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

    const result = await pool.query<NearbyItem>(query, [
      lon,
      lat,
      radiusMeters,
      limit,
    ]);
    res.json({
      lon,
      lat,
      radius_m: radiusMeters,
      count: result.rowCount,
      items: result.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    res.status(400).json({ error: message });
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message =
    err instanceof Error ? err.message : "Unexpected server error";
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
