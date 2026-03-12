#!/usr/bin/env node

/**
 * Benchmarks three variants of JSON batch query optimization:
 *   1. batch-no-bbox     — Baseline (exp-05 optimal, no explicit bbox filter)
 *   2. batch-with-bbox   — With explicit bbox filter (way && point)
 *   3. batch-with-bbox-indexed — With bbox filter using transformed geometry
 *
 * Hypothesis: Explicit bounding box filters should improve performance by 15-25%
 * due to index-only scans eliminating non-containing polygons before ST_Covers test.
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Bounding Box Filter Optimization (JSON Batch Only)",
  resultsDir: path.join(ROOT, "benchmark-results", "07_bbox_filter_optimization"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Baseline: No bbox filter ─────────────────────────────────────────────
    {
      label: "no-bbox_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/07/batch-no-bbox`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    // ── With bbox filter (simple) ────────────────────────────────────────────
    {
      label: "with-bbox_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/07/batch-with-bbox`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    // ── With bbox filter (indexed/transformed) ───────────────────────────────
    {
      label: "with-bbox-indexed_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/07/batch-with-bbox-indexed`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
  ],
});

await bench.run();
