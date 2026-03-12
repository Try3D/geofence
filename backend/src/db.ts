import { Pool } from "pg";

export const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 6432),
  user: process.env.PGUSER || "gis",
  password: process.env.PGPASSWORD || "gis",
  database: process.env.PGDATABASE || "gis",
  max: 40,
});
