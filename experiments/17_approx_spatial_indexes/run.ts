#!/usr/bin/env node
/**
 * Benchmarks GIST vs SP-GiST vs BRIN spatial indexes for batch geofence lookups.
 *
 * Hypothesis: SP-GiST (quad-tree / k-d tree) may outperform GIST for point
 * containment queries due to better space partitioning; BRIN after CLUSTER
 * provides extreme compactness at the cost of more false positives.
 *
 * 3 variants × 3 VU levels × 2 modes (single, batch-1000) = 18 k6 runs (~18 min)
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const VARIANTS = ["gist", "spgist", "brin"] as const;

// Single-point mode: batchSize=1, VUs=[10, 20, 40]
const SINGLE_VUS = [10, 20, 40];

// Batch mode: batchSize=1000, VUs=[5, 10, 20]
const BATCH_VUS = [5, 10, 20];
const BATCH_SIZE = 1000;

const singleExperiments = VARIANTS.flatMap((variant) =>
  SINGLE_VUS.map((vus) => ({
    label: `${variant}_single_vus=${vus}`,
    vus,
    batchSize: 1,
    extraEnv: {
      METHOD: "POST",
      TARGET_URL: `${BASE_URL}/exp/17/${variant}`,
      BODY: JSON.stringify({ points: randomPoints(1) }),
      GENERATE_BODY: "true",
    },
  }))
);

const batchExperiments = VARIANTS.flatMap((variant) =>
  BATCH_VUS.map((vus) => ({
    label: `${variant}_1000_vus=${vus}`,
    vus,
    batchSize: BATCH_SIZE,
    extraEnv: {
      METHOD: "POST",
      TARGET_URL: `${BASE_URL}/exp/17/${variant}`,
      BODY: JSON.stringify({ points: randomPoints(BATCH_SIZE) }),
      GENERATE_BODY: "true",
    },
  }))
);

const bench = new Benchmark({
  name: "17 — Approximate Spatial Indexes: GIST vs SP-GiST vs BRIN",
  resultsDir: path.join(ROOT, "benchmark-results", "17_approx_spatial_indexes"),
  ...GEOFENCE_PRESETS,
  experiments: [...singleExperiments, ...batchExperiments],
});

await bench.run();
