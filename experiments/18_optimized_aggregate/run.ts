#!/usr/bin/env node
/**
 * Benchmarks the optimized aggregate backend vs the naive baseline,
 * demonstrating the cumulative effect of all winning optimizations from Exp-01–17.
 *
 * Optimizations included in exp-18:
 *   Exp-01: Pool max=15
 *   Exp-03: Promise.all chunking (chunk=100)
 *   Exp-04: planet_osm_polygon_simple_10 as fallback
 *   Exp-05: JSON-expansion (unnest + LEFT JOIN + GROUP BY ordinality)
 *   Exp-07: bbox pre-filter (bounds && pt) before ST_Contains
 *   Exp-09: SET jit = off
 *   Exp-10: ids-only mode (omit name)
 *   Exp-11: hierarchy_boundaries first-pass (40K rows vs 56M)
 *   Exp-12: bounds_4326 column — no ST_Transform on hierarchy queries
 *   Exp-14: ST_Contains instead of ST_Covers
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const VUS = 20; // single VU level for fair apples-to-apples comparison

const bench = new Benchmark({
  name: "18 — Optimized Aggregate vs Naive Baseline",
  resultsDir: path.join(ROOT, "benchmark-results", "18_optimized_aggregate"),
  ...GEOFENCE_PRESETS,
  experiments: [
    // ── BASELINE: naive planet_osm_polygon full-scan (exp-11/baseline) ──────
    {
      label: "baseline_single_vus=20",
      vus: VUS,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/baseline`,
        BODY: JSON.stringify({ points: randomPoints(1) }),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "baseline_batch1000_vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/baseline`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },

    // ── OPTIMIZED: exp-18 all-in (hierarchy + simple_10 fallback) ───────────
    {
      label: "optimized_single_vus=20",
      vus: VUS,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/18/single`,
        BODY: JSON.stringify(randomPoints(1)[0]),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "optimized_single_vus=10",
      vus: 10,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/18/single`,
        BODY: JSON.stringify(randomPoints(1)[0]),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "optimized_single_vus=50",
      vus: 50,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/18/single`,
        BODY: JSON.stringify(randomPoints(1)[0]),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "optimized_batch1000_vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/18/batch`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },
    {
      label: "optimized_batch1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/18/batch`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },
  ],
});

await bench.run();
