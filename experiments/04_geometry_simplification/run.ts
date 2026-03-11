#!/usr/bin/env node

/**
 * Benchmarks simplified-geometry endpoints vs the original table.
 * Simplified tables must exist in the DB (see db/migrations/).
 *
 * Endpoints tested:
 *   /api/polygons/batch          — original geometry
 *   /api/polygons/batch-simple10 — simple_10 (10 m tolerance)
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
        TARGET_URL: "http://localhost:3000/api/polygons/batch-simple10",
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "simple_10 vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch-simple10",
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
  ],
});

await bench.run();
