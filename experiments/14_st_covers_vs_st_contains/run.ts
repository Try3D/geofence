#!/usr/bin/env node

/**
 * Benchmarks ST_Covers vs ST_Contains spatial predicates
 *
 * Compares 2 approaches:
 *   1. contains: ST_Contains(hb.bounds_4326, pts.g) — false on boundary
 *   2. covers:  ST_Covers(hb.bounds_4326, pts.g)   — true on boundary
 *
 * Tests single-point and batch-1000 workloads at 2 VU levels each
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

function makeExperiments() {
  const exps: Array<{
    label: string;
    vus: number;
    batchSize: number;
    extraEnv: Record<string, string>;
  }> = [];

  // Single-point: 2 variants × 3 VU levels
  for (const vus of [10, 20, 40]) {
    for (const variant of ["contains", "covers"]) {
      exps.push({
        label: `single_${variant}_vus=${vus}`,
        vus,
        batchSize: 1,
        extraEnv: {
          METHOD: "POST",
          TARGET_URL: `${BASE_URL}/exp/14/${variant}`,
          BODY: JSON.stringify({ points: randomPoints(1) }),
          GENERATE_BODY: "true",
        },
      });
    }
  }

  // Batch-1000: 2 variants × 3 VU levels
  for (const vus of [5, 10, 20]) {
    for (const variant of ["contains", "covers"]) {
      exps.push({
        label: `batch1000_${variant}_vus=${vus}`,
        vus,
        batchSize: 1000,
        extraEnv: {
          METHOD: "POST",
          TARGET_URL: `${BASE_URL}/exp/14/${variant}`,
          BODY: JSON.stringify({ points: randomPoints(1000) }),
          GENERATE_BODY: "true",
        },
      });
    }
  }

  return exps;
}

const bench = new Benchmark({
  name: "ST_Covers vs ST_Contains: Spatial Predicate Comparison",
  resultsDir: path.join(ROOT, "benchmark-results", "14_st_covers_vs_st_contains"),

  ...GEOFENCE_PRESETS,

  experiments: makeExperiments(),
});

await bench.run();
