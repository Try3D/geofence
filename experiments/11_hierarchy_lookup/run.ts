#!/usr/bin/env node

/**
 * Benchmarks hierarchical boundary lookups
 *
 * Compares 2 approaches:
 *   1. baseline: Full planet_osm_polygon scan (complete but slow)
 *   2. normal: Direct hierarchy_boundaries lookup (fast but incomplete)
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
  name: "Hierarchical Boundary Lookups",
  resultsDir: path.join(ROOT, "benchmark-results", "11_hierarchy_lookup"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Single-point, 20 VUs ─────────────────────────────────────────────────
    {
      label: "single_baseline_vus=20",
      vus: 20,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/baseline`,
        BODY: JSON.stringify({ points: randomPoints(1) }),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "single_normal_vus=20",
      vus: 20,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/normal`,
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
        TARGET_URL: `${BASE_URL}/exp/11/baseline`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "batch-1000_normal_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/normal`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },
  ],
});

await bench.run();
