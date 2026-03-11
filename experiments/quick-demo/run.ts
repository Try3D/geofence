#!/usr/bin/env node

/**
 * Quick benchmark test - demonstrates the profiler system
 * Runs short duration tests without pool size mutations
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const bench = new Benchmark({
  name: "Quick Demo - Batch API",
  resultsDir: path.join(ROOT, "benchmark-results", "quick-demo"),

  k6: {
    ...GEOFENCE_PRESETS.k6,
    duration: "10s",
  },

  experiments: [
    {
      label: "batch=100 vus=5",
      vus: 5,
      batchSize: 100,
      extraEnv: {
        BODY: JSON.stringify({ points: randomPoints(100), limit: 20 }),
      },
    },
    {
      label: "batch=500 vus=5",
      vus: 5,
      batchSize: 500,
      extraEnv: {
        BODY: JSON.stringify({ points: randomPoints(500), limit: 20 }),
      },
    },
    {
      label: "batch=1000 vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "batch=1000 vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
  ],
});

await bench.run();
