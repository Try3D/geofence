#!/usr/bin/env node

/**
 * Benchmarks hierarchical boundary lookups
 * 
 * Compares 4 approaches to administrative boundary matching:
 *   1. baseline: Full planet_osm_polygon scan (complete but slow)
 *   2. normal: Direct hierarchy_boundaries lookup (fast but incomplete)
 *   3. cte: Recursive CTE with full ancestor hierarchy
 *   4. cte-fallback: CTE with fallback to planet_osm_polygon for unmatched points
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
    // ── Batch Size 10 ────────────────────────────────────────────────────────
    {
      label: "batch-10_baseline_vus=10",
      vus: 10,
      batchSize: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/baseline`,
        BODY: JSON.stringify({ points: randomPoints(10) }),
      },
    },
    {
      label: "batch-10_normal_vus=10",
      vus: 10,
      batchSize: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/normal`,
        BODY: JSON.stringify({ points: randomPoints(10) }),
      },
    },
    {
      label: "batch-10_cte_vus=10",
      vus: 10,
      batchSize: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/cte`,
        BODY: JSON.stringify({ points: randomPoints(10) }),
      },
    },
    {
      label: "batch-10_cte-fallback_vus=10",
      vus: 10,
      batchSize: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/cte-fallback`,
        BODY: JSON.stringify({ points: randomPoints(10) }),
      },
    },

    // ── Batch Size 25 ────────────────────────────────────────────────────────
    {
      label: "batch-25_baseline_vus=10",
      vus: 10,
      batchSize: 25,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/baseline`,
        BODY: JSON.stringify({ points: randomPoints(25) }),
      },
    },
    {
      label: "batch-25_normal_vus=10",
      vus: 10,
      batchSize: 25,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/normal`,
        BODY: JSON.stringify({ points: randomPoints(25) }),
      },
    },
    {
      label: "batch-25_cte_vus=10",
      vus: 10,
      batchSize: 25,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/cte`,
        BODY: JSON.stringify({ points: randomPoints(25) }),
      },
    },
    {
      label: "batch-25_cte-fallback_vus=10",
      vus: 10,
      batchSize: 25,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/cte-fallback`,
        BODY: JSON.stringify({ points: randomPoints(25) }),
      },
    },

    // ── Batch Size 50 ────────────────────────────────────────────────────────
    {
      label: "batch-50_baseline_vus=10",
      vus: 10,
      batchSize: 50,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/baseline`,
        BODY: JSON.stringify({ points: randomPoints(50) }),
      },
    },
    {
      label: "batch-50_normal_vus=10",
      vus: 10,
      batchSize: 50,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/normal`,
        BODY: JSON.stringify({ points: randomPoints(50) }),
      },
    },
    {
      label: "batch-50_cte_vus=10",
      vus: 10,
      batchSize: 50,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/cte`,
        BODY: JSON.stringify({ points: randomPoints(50) }),
      },
    },
    {
      label: "batch-50_cte-fallback_vus=10",
      vus: 10,
      batchSize: 50,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/cte-fallback`,
        BODY: JSON.stringify({ points: randomPoints(50) }),
      },
    },

    // ── Batch Size 1000 (separate, heavy test) ────────────────────────────────
    {
      label: "batch-1000_baseline_vus=10",
      vus: 10,
      batchSize: 1000,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/baseline`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "batch-1000_normal_vus=10",
      vus: 10,
      batchSize: 1000,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/normal`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "batch-1000_cte_vus=10",
      vus: 10,
      batchSize: 1000,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/cte`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "batch-1000_cte-fallback_vus=10",
      vus: 10,
      batchSize: 1000,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/11/cte-fallback`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
  ],
});

await bench.run();
