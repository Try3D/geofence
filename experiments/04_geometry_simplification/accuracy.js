#!/usr/bin/env node

/**
 * Monte Carlo accuracy analysis for geometry simplification levels.
 *
 * Generates N random points, queries each simplification level directly via DB
 * (no HTTP, no k6), computes Intersection over Union (IoU) vs the original
 * geometry, and prints a summary table of accuracy + latency per level.
 *
 * Run standalone — does NOT affect k6 benchmarks.
 */

import pg from "pg";
import { performance } from "perf_hooks";

const N = 2000; // random test points
const LIMIT = 50; // max results per point (high enough to catch all matches)

const MIN_LON = -2.937207, MAX_LON = 7.016791;
const MIN_LAT = 43.238664, MAX_LAT = 49.428801;

const LEVELS = [
  { name: "original",     table: "planet_osm_polygon" },
  { name: "simple_10",    table: "planet_osm_polygon_simple_10" },
  { name: "simple_100",   table: "planet_osm_polygon_simple_100" },
  { name: "simple_500",   table: "planet_osm_polygon_simple_500" },
  { name: "simple_1000",  table: "planet_osm_polygon_simple_1000" },
];

const client = new pg.Client({
  host:     process.env.PGHOST     || "localhost",
  port:     Number(process.env.PGPORT || 5432),
  user:     process.env.PGUSER     || "gis",
  password: process.env.PGPASSWORD || "gis",
  database: process.env.PGDATABASE || "gis",
});

function randomPoints(n) {
  return Array.from({ length: n }, () => ({
    lon: MIN_LON + Math.random() * (MAX_LON - MIN_LON),
    lat: MIN_LAT + Math.random() * (MAX_LAT - MIN_LAT),
  }));
}

// Returns Map<pointIdx, Set<osm_id>> for all N points in one query
async function queryLevel(table, lons, lats) {
  const sql = `
    WITH pts AS (
      SELECT ordinality AS idx,
             ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    )
    SELECT pts.idx::int, match.osm_id::text
    FROM pts
    CROSS JOIN LATERAL (
      SELECT p.osm_id::text
      FROM ${table} p
      WHERE ST_Covers(p.way, pts.g)
      LIMIT $3
    ) match
  `;
  const result = await client.query(sql, [lons, lats, LIMIT]);

  const map = new Map();
  for (let i = 1; i <= lons.length; i++) map.set(i, new Set());
  for (const row of result.rows) {
    map.get(row.idx).add(row.osm_id);
  }
  return map;
}

function iou(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1.0; // both agree: no match
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

async function getVertexStats(table) {
  const res = await client.query(
    `SELECT round(avg(ST_NPoints(way)))::int AS avg_pts,
            round(sum(ST_NPoints(way)))::bigint AS total_pts
     FROM ${table}`
  );
  return res.rows[0];
}

function formatTable(rows) {
  const headers = ["level", "Avg IoU", "FP%", "FN%", "Empty match%", "Avg verts", "Reduction", "Latency", "Speedup"];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length))
  );
  let out = headers.map((h, i) => h.padEnd(widths[i])).join(" │ ") + "\n";
  out += widths.map((w) => "─".repeat(w)).join("─┼─") + "\n";
  for (const row of rows) {
    out += row.map((cell, i) => String(cell).padEnd(widths[i])).join(" │ ") + "\n";
  }
  return out;
}

await client.connect();

console.log(`\nGenerating ${N} random test points...`);
const points = randomPoints(N);
const lons = points.map((p) => p.lon);
const lats = points.map((p) => p.lat);

// Get original vertex stats
const origStats = await getVertexStats("planet_osm_polygon");

console.log(`Running queries across ${LEVELS.length} levels...\n`);

const levelResults = [];
let originalMap = null;
let originalLatency = null;

for (const level of LEVELS) {
  process.stdout.write(`  ${level.name.padEnd(14)} ... `);

  let vertStats;
  try {
    vertStats = await getVertexStats(level.table);
  } catch {
    console.log("table not found, skipping");
    continue;
  }

  const t0 = performance.now();
  const resultMap = await queryLevel(level.table, lons, lats);
  const elapsed = performance.now() - t0;

  if (level.name === "original") {
    originalMap = resultMap;
    originalLatency = elapsed;
    levelResults.push({ level, resultMap, elapsed, vertStats });
    console.log(`${elapsed.toFixed(0)}ms (baseline)`);
    continue;
  }

  levelResults.push({ level, resultMap, elapsed, vertStats });
  console.log(`${elapsed.toFixed(0)}ms`);
}

console.log("\nComputing accuracy metrics...\n");

const tableRows = [];

for (const { level, resultMap, elapsed, vertStats } of levelResults) {
  const ious = [];
  let fpCount = 0;   // simplified has extra matches
  let fnCount = 0;   // simplified missed matches
  let emptyBoth = 0; // both returned nothing

  for (let i = 1; i <= N; i++) {
    const orig = originalMap.get(i) ?? new Set();
    const simp = resultMap.get(i) ?? new Set();

    if (orig.size === 0 && simp.size === 0) {
      emptyBoth++;
      ious.push(1.0);
      continue;
    }

    ious.push(iou(orig, simp));

    for (const id of simp) { if (!orig.has(id)) fpCount++; }
    for (const id of orig) { if (!simp.has(id)) fnCount++; }
  }

  const avgIou     = ious.reduce((a, b) => a + b, 0) / ious.length;
  const totalMatches = [...originalMap.values()].reduce((a, s) => a + s.size, 0);
  const fpRate    = totalMatches > 0 ? (fpCount / totalMatches * 100).toFixed(1) + "%" : "-";
  const fnRate    = totalMatches > 0 ? (fnCount / totalMatches * 100).toFixed(1) + "%" : "-";
  const emptyRate = (emptyBoth / N * 100).toFixed(1) + "%";
  const reduction = level.name === "original"
    ? "0%"
    : ((1 - vertStats.avg_pts / origStats.avg_pts) * 100).toFixed(0) + "%";
  const speedup = level.name === "original"
    ? "baseline"
    : (originalLatency / elapsed).toFixed(2) + "×";

  tableRows.push([
    level.name,
    avgIou.toFixed(4),
    fpRate,
    fnRate,
    emptyRate,
    vertStats.avg_pts ?? "?",
    reduction,
    elapsed.toFixed(0) + "ms",
    speedup,
  ]);
}

console.log(formatTable(tableRows));
console.log(`Test points: ${N}  |  Bounding box: France (approx)`);
console.log(`IoU=1.0 means perfect match. FP=false positives, FN=false negatives vs original.\n`);

await client.end();
