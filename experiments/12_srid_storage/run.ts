#!/usr/bin/env node

/**
 * Benchmarks SRID storage impact on hierarchy lookups
 *
 * Compares 2 approaches:
 *   1. baseline: Transform to 3857, use bounds column (current approach)
 *   2. native: Use 4326 directly, no transform, use bounds_4326 column
 *
 * 2 variants × 2 batch sizes = 4 experiments total
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "SRID Storage: 4326 vs 3857",
  resultsDir: path.join(ROOT, "benchmark-results", "12_srid_storage"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Single-point, 20 VUs ─────────────────────────────────────────────────
    {
      label: "single_baseline_vus=20",
      vus: 20,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/12/baseline`,
        BODY: JSON.stringify({ points: randomPoints(1) }),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "single_native_vus=20",
      vus: 20,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/12/native`,
        BODY: JSON.stringify({ points: randomPoints(1) }),
        GENERATE_BODY: "true",
      },
    },

    // ── Batch-1000, 10 VUs ───────────────────────────────────────────────────
    {
      label: "batch-1000_baseline_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/12/baseline`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "batch-1000_native_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/12/native`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },
  ],
});

await bench.run();
