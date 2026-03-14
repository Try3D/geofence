#!/usr/bin/env node

/**
 * Benchmarks SRID storage impact on hierarchy lookups
 *
 * Compares 2 approaches:
 *   1. baseline: Transform to 3857, use bounds column (current approach)
 *   2. native: Use 4326 directly, no transform, use bounds_4326 column
 *
 * Multi-trial VU sweep: each variant/size/vus combo run 3 times
 * - Single-point: vus = 10, 20, 40 × 2 variants × 3 runs = 18 experiments
 * - Batch-1000: vus = 5, 10, 20 × 2 variants × 3 runs = 18 experiments
 * Total: 36 experiments × 60s = ~36 minutes
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

  // Single-point sweep: vus = 10, 20, 40 × 2 variants × 3 runs
  for (const vus of [10, 20, 40]) {
    for (const variant of ["baseline", "native"]) {
      for (let run = 1; run <= 3; run++) {
        exps.push({
          label: `single_${variant}_vus=${vus}_run${run}`,
          vus,
          batchSize: 1,
          extraEnv: {
            METHOD: "POST",
            TARGET_URL: `${BASE_URL}/exp/12/${variant}`,
            BODY: JSON.stringify({ points: randomPoints(1) }),
            GENERATE_BODY: "true",
          },
        });
      }
    }
  }

  // Batch-1000 sweep: vus = 5, 10, 20 × 2 variants × 3 runs
  for (const vus of [5, 10, 20]) {
    for (const variant of ["baseline", "native"]) {
      for (let run = 1; run <= 3; run++) {
        exps.push({
          label: `batch-1000_${variant}_vus=${vus}_run${run}`,
          vus,
          batchSize: 1000,
          extraEnv: {
            METHOD: "POST",
            TARGET_URL: `${BASE_URL}/exp/12/${variant}`,
            BODY: JSON.stringify({ points: randomPoints(1000) }),
            GENERATE_BODY: "true",
          },
        });
      }
    }
  }

  return exps;
}

const bench = new Benchmark({
  name: "SRID Storage: 4326 vs 3857 (Multi-trial VU Sweep)",
  resultsDir: path.join(ROOT, "benchmark-results", "12_srid_storage"),

  ...GEOFENCE_PRESETS,

  experiments: makeExperiments(),
});

await bench.run();
