import Fastify from "fastify";
import pg from "pg";

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL ?? "postgresql://gis:gis@localhost:5432/gis";
const PORT = parseInt(process.env.PORT ?? "3002");

const pool = new Pool({ connectionString: DB_URL, max: 40 });

const QUERY = `
  WITH points AS (
    SELECT (ordinality - 1) AS idx, lon, lat
    FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
  ),
  pts AS (
    SELECT idx, ST_SetSRID(ST_Point(lon, lat), 4326) AS g
    FROM points
  ),
  deepest_match AS (
    SELECT pts.idx, hb.id, hb.osm_id, hb.name, hb.admin_level, hb.depth,
      ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY hb.depth DESC) as rn
    FROM pts
    JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds_4326, pts.g)
  )
  SELECT idx,
    json_build_array(json_build_object(
      'id', id, 'osm_id', osm_id, 'name', name,
      'admin_level', admin_level, 'depth', depth
    )) as hierarchy
  FROM deepest_match WHERE rn = 1
`;

const app = Fastify({ logger: true });

app.post("/exp/13/fastify", async (req, reply) => {
  try {
    const { points } = req.body as { points: Array<{ lon: number; lat: number }> };
    const lons = points.map((p) => p.lon);
    const lats = points.map((p) => p.lat);

    const result = await pool.query(QUERY, [lons, lats]);

    const grouped: Record<number, { idx: number; hierarchy: unknown }> = {};
    for (let i = 0; i < points.length; i++) grouped[i] = { idx: i, hierarchy: [] };
    for (const row of result.rows)
      grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy ?? [] };

    return { count: points.length, results: Object.values(grouped) };
  } catch (err) {
    req.log.error(err, "handler error");
    throw err;
  }
});

app.get("/health", async () => ({ ok: true }));

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`Fastify (Node.js + pg) listening on http://localhost:${PORT}`);
