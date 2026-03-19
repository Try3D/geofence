#!/usr/bin/env node

/**
 * Benchmarks unsorted vs geohash-sorted (Morton code) batch spatial queries
 *
 * Hypothesis: sorting input points by Z-order (Morton code) before querying
 * PostgreSQL improves buffer cache locality in the spatial index, reducing
 * random I/O and lowering latency.
 *
 * Compares 2 variants × 3 batch sizes × 3 VU levels = 18 experiments
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

  const batchSize = 1000;
  const vuLevels = [5, 10, 20];
  for (const vus of vuLevels) {
    for (const variant of ["unsorted", "geohash-sorted"]) {
      exps.push({
        label: `batch1000_${variant}_vus=${vus}`,
        vus,
        batchSize,
        extraEnv: {
          METHOD: "POST",
          TARGET_URL: `${BASE_URL}/exp/15/${variant}`,
          BODY: JSON.stringify({ points: randomPoints(batchSize) }),
          GENERATE_BODY: "true",
        },
      });
    }
  }

  return exps;
}

const bench = new Benchmark({
  name: "Sorted Spatial Batches: Morton Code Z-order Cache Locality",
  resultsDir: path.join(ROOT, "benchmark-results", "15_sorted_spatial_batches"),

  ...GEOFENCE_PRESETS,

  experiments: makeExperiments(),
});

await bench.run();
