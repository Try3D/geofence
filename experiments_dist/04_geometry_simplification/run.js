#!/usr/bin/env node
/**
 * Benchmarks simplified-geometry vs the original table.
 * Simplified tables must exist in the DB (see db/migrations/).
 *
 * Endpoint tested:
 *   /api/polygons/batch with table parameter
 *     - table=original (or omit) -> planet_osm_polygon
 *     - table=planet_osm_polygon_simple_10 -> simplified geometry
 */
import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const bench = new Benchmark({
    name: "Geometry Simplification Benchmark",
    resultsDir: path.join(ROOT, "benchmark-results", "04_geometry_simplification"),
    ...GEOFENCE_PRESETS,
    experiments: [
        // ── Original geometry ────────────────────────────────────────────────────
        {
            label: "original vus=5",
            vus: 5,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
            },
        },
        {
            label: "original vus=10",
            vus: 10,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
            },
        },
        // ── simple_10 (10 m tolerance) ────────────────────────────────────────
        {
            label: "simple_10 vus=5",
            vus: 5,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20, table: "planet_osm_polygon_simple_10" }),
            },
        },
        {
            label: "simple_10 vus=10",
            vus: 10,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20, table: "planet_osm_polygon_simple_10" }),
            },
        },
        // ── simple_100 (100 m tolerance) ──────────────────────────────────────
        {
            label: "simple_100 vus=5",
            vus: 5,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20, table: "planet_osm_polygon_simple_100" }),
            },
        },
        {
            label: "simple_100 vus=10",
            vus: 10,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20, table: "planet_osm_polygon_simple_100" }),
            },
        },
        // ── simple_500 (500 m tolerance) ──────────────────────────────────────
        {
            label: "simple_500 vus=5",
            vus: 5,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20, table: "planet_osm_polygon_simple_500" }),
            },
        },
        {
            label: "simple_500 vus=10",
            vus: 10,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20, table: "planet_osm_polygon_simple_500" }),
            },
        },
        // ── simple_1000 (1000 m tolerance) ───────────────────────────────────
        {
            label: "simple_1000 vus=5",
            vus: 5,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20, table: "planet_osm_polygon_simple_1000" }),
            },
        },
        {
            label: "simple_1000 vus=10",
            vus: 10,
            batchSize: 1000,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: randomPoints(1000), limit: 20, table: "planet_osm_polygon_simple_1000" }),
            },
        },
    ],
});
await bench.run();
