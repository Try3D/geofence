#!/usr/bin/env node

/**
 * Compares single-point vs batch throughput for the geofence API.
 * Measures point-lookups/sec for each approach at the same concurrency.
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoint, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const bench = new Benchmark({
  name: "Single vs Batch Throughput Comparison",
  resultsDir: path.join(ROOT, "benchmark-results", "02_batch_vs_single"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Single-point: 1 lookup per request ──────────────────────────────────
    {
      label: "single vus=5",
      apiPool: 15,
      pgPool: 25,
      vus: 5,
      batchSize: 1,
      extraEnv: {
        METHOD: "GET",
        TARGET_URL: `http://localhost:3000/api/polygons/contains?lon=${randomPoint().lon}&lat=${randomPoint().lat}&limit=20`,
      },
    },
    {
      label: "single vus=15",
      apiPool: 15,
      pgPool: 25,
      vus: 15,
      batchSize: 1,
      extraEnv: {
        METHOD: "GET",
        TARGET_URL: `http://localhost:3000/api/polygons/contains?lon=${randomPoint().lon}&lat=${randomPoint().lat}&limit=20`,
      },
    },
    {
      label: "single vus=25",
      apiPool: 15,
      pgPool: 25,
      vus: 25,
      batchSize: 1,
      extraEnv: {
        METHOD: "GET",
        TARGET_URL: `http://localhost:3000/api/polygons/contains?lon=${randomPoint().lon}&lat=${randomPoint().lat}&limit=20`,
      },
    },

    // ── Batch: 1000 lookups per request ─────────────────────────────────────
    {
      label: "batch=1000 vus=5",
      apiPool: 15,
      pgPool: 25,
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch",
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "batch=1000 vus=10",
      apiPool: 15,
      pgPool: 25,
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch",
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "batch=1000 vus=20",
      apiPool: 15,
      pgPool: 25,
      vus: 20,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch",
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
  ],
});

await bench.run();
