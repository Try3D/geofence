#!/usr/bin/env node

/**
 * Benchmarks SQL query optimization approaches:
 *   1. Baseline: Dynamic SQL (no caching)
 *   2. Prepared: Simulated prepared statement (plan caching)
 *   3. Function: Server-side PL/pgSQL function (consolidated logic)
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "SQL Function & Prepared Statement Optimization",
  resultsDir: path.join(ROOT, "benchmark-results", "08_sql_functions"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Batch Size 10 ────────────────────────────────────────────────────────
    {
      label: "batch-10_baseline_vus=10",
      batchSize: 10,
      variant: "baseline",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/baseline`,
        BODY: JSON.stringify({
          points: randomPoints(10),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-10_prepared_vus=10",
      batchSize: 10,
      variant: "prepared",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/prepared`,
        BODY: JSON.stringify({
          points: randomPoints(10),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-10_function_vus=10",
      batchSize: 10,
      variant: "function",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/function`,
        BODY: JSON.stringify({
          points: randomPoints(10),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },

    // ── Batch Size 50 ────────────────────────────────────────────────────────
    {
      label: "batch-50_baseline_vus=10",
      batchSize: 50,
      variant: "baseline",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/baseline`,
        BODY: JSON.stringify({
          points: randomPoints(50),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-50_prepared_vus=10",
      batchSize: 50,
      variant: "prepared",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/prepared`,
        BODY: JSON.stringify({
          points: randomPoints(50),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-50_function_vus=10",
      batchSize: 50,
      variant: "function",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/function`,
        BODY: JSON.stringify({
          points: randomPoints(50),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },

    // ── Batch Size 100 ───────────────────────────────────────────────────────
    {
      label: "batch-100_baseline_vus=10",
      batchSize: 100,
      variant: "baseline",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/baseline`,
        BODY: JSON.stringify({
          points: randomPoints(100),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-100_prepared_vus=10",
      batchSize: 100,
      variant: "prepared",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/prepared`,
        BODY: JSON.stringify({
          points: randomPoints(100),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-100_function_vus=10",
      batchSize: 100,
      variant: "function",
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/08/function`,
        BODY: JSON.stringify({
          points: randomPoints(100),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
  ],
});

await bench.run();
