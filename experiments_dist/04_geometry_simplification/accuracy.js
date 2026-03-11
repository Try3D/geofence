#!/usr/bin/env node
/**
 * Accuracy analysis for geometry simplification levels using F1-score.
 *
 * Generates N random points, queries each simplification level directly via DB
 * (no HTTP, no k6), computes F1-score, Precision, and Recall vs the original
 * geometry (ground truth), and prints a summary table.
 *
 * Run standalone — does NOT affect k6 benchmarks.
 */
import pg from "pg";
import { performance } from "perf_hooks";
const N = 2000; // random test points
const LIMIT = 50; // max results per point (high enough to catch all matches)
const MIN_LON = -2.937207;
const MAX_LON = 7.016791;
const MIN_LAT = 43.238664;
const MAX_LAT = 49.428801;
const LEVELS = [
    { name: "original", table: "planet_osm_polygon" },
    { name: "simple_10", table: "planet_osm_polygon_simple_10" },
    { name: "simple_100", table: "planet_osm_polygon_simple_100" },
    { name: "simple_500", table: "planet_osm_polygon_simple_500" },
    { name: "simple_1000", table: "planet_osm_polygon_simple_1000" },
];
const client = new pg.Client({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "gis",
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
    for (let i = 1; i <= lons.length; i++)
        map.set(i, new Set());
    for (const row of result.rows) {
        map.get(row.idx).add(row.osm_id);
    }
    return map;
}
async function getVertexStats(table) {
    const res = await client.query(`SELECT round(avg(ST_NPoints(way)))::int AS avg_pts,
            round(sum(ST_NPoints(way)))::bigint AS total_pts
     FROM ${table}`);
    return res.rows[0];
}
function calculateAccuracyMetrics(groundTruth, predicted, numPoints) {
    let totalTp = 0;
    let totalFp = 0;
    let totalFn = 0;
    let perfectMatches = 0;
    for (let i = 1; i <= numPoints; i++) {
        const gt = groundTruth.get(i) ?? new Set();
        const pred = predicted.get(i) ?? new Set();
        // True Positives: polygons in both sets
        const tp = [...pred].filter((x) => gt.has(x)).length;
        // False Positives: polygons in predicted but not in ground truth
        const fp = [...pred].filter((x) => !gt.has(x)).length;
        // False Negatives: polygons in ground truth but not in predicted
        const fn = [...gt].filter((x) => !pred.has(x)).length;
        totalTp += tp;
        totalFp += fp;
        totalFn += fn;
        // Perfect match if TP == pred.size && TP == gt.size
        if (tp === pred.size && tp === gt.size) {
            perfectMatches++;
        }
    }
    // Calculate Precision: TP / (TP + FP)
    const precision = totalTp + totalFp > 0
        ? totalTp / (totalTp + totalFp)
        : 1.0; // If no predictions, precision is perfect
    // Calculate Recall: TP / (TP + FN)
    const recall = totalTp + totalFn > 0
        ? totalTp / (totalTp + totalFn)
        : 1.0; // If no ground truth, recall is perfect
    // Calculate F1: 2 * (Precision * Recall) / (Precision + Recall)
    const f1 = precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 1.0; // Both 0 means perfect match (no polygons)
    const perfectMatchPct = (perfectMatches / numPoints) * 100;
    return { precision, recall, f1, perfectMatchPct };
}
function formatTable(rows) {
    const headers = [
        "Level",
        "Precision",
        "Recall",
        "F1-Score",
        "Perfect%",
        "Avg Verts",
        "Reduction",
        "Latency",
        "Speedup",
    ];
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
    let out = headers.map((h, i) => h.padEnd(widths[i])).join(" │ ") + "\n";
    out += widths.map((w) => "─".repeat(w)).join("─┼─") + "\n";
    for (const row of rows) {
        out +=
            row.map((cell, i) => String(cell).padEnd(widths[i])).join(" │ ") +
                "\n";
    }
    return out;
}
async function main() {
    await client.connect();
    console.log(`\nGenerating ${N} random test points in France...`);
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
        }
        catch {
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
            console.log(`${elapsed.toFixed(0)}ms (baseline, ground truth)`);
            continue;
        }
        levelResults.push({ level, resultMap, elapsed, vertStats });
        console.log(`${elapsed.toFixed(0)}ms`);
    }
    console.log("\nComputing F1-score accuracy metrics...\n");
    const tableRows = [];
    for (const { level, resultMap, elapsed, vertStats } of levelResults) {
        const metrics = calculateAccuracyMetrics(originalMap, resultMap, N);
        const reduction = level.name === "original"
            ? "0%"
            : ((1 - vertStats.avg_pts / origStats.avg_pts) * 100).toFixed(0) + "%";
        const speedup = level.name === "original"
            ? "baseline"
            : (originalLatency / elapsed).toFixed(2) + "×";
        tableRows.push([
            level.name,
            metrics.precision.toFixed(4),
            metrics.recall.toFixed(4),
            metrics.f1.toFixed(4),
            metrics.perfectMatchPct.toFixed(1) + "%",
            String(vertStats.avg_pts ?? "?"),
            reduction,
            elapsed.toFixed(0) + "ms",
            speedup,
        ]);
    }
    console.log(formatTable(tableRows));
    console.log(`\nTest points: ${N}  |  Bounding box: France (approx)`);
    console.log(`Precision: TP / (TP + FP) - how many returned results were correct`);
    console.log(`Recall: TP / (TP + FN) - how many correct results did we find`);
    console.log(`F1-Score: harmonic mean of precision and recall (1.0 = perfect)\n`);
    await client.end();
}
main();
