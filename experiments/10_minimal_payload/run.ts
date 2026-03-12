#!/usr/bin/env node

/**
 * Benchmarks minimal payload optimization
 * 
 * Compares response formats to optimize payload size and network overhead:
 *   1. full: { osm_id, name, admin_level } — Full response
 *   2. ids-only: [osm_id] — IDs from full query, names fetched separately
 *   3. ids-optimized: [osm_id] — Query optimized to exclude name from start
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Minimal Payload Optimization",
  resultsDir: path.join(ROOT, "benchmark-results", "10_minimal_payload"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Batch Size 10 ────────────────────────────────────────────────────────
    {
      label: "batch-10_full_vus=10",
      vus: 10,
      batchSize: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/full`,
        BODY: JSON.stringify({ 
          points: randomPoints(10),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-10_ids-only_vus=10",
      vus: 10,
      batchSize: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/ids-only`,
        BODY: JSON.stringify({ 
          points: randomPoints(10),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-10_ids-optimized_vus=10",
      vus: 10,
      batchSize: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/ids-optimized`,
        BODY: JSON.stringify({ 
          points: randomPoints(10),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },

    // ── Batch Size 50 ────────────────────────────────────────────────────────
    {
      label: "batch-50_full_vus=10",
      vus: 10,
      batchSize: 50,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/full`,
        BODY: JSON.stringify({ 
          points: randomPoints(50),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-50_ids-only_vus=10",
      vus: 10,
      batchSize: 50,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/ids-only`,
        BODY: JSON.stringify({ 
          points: randomPoints(50),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-50_ids-optimized_vus=10",
      vus: 10,
      batchSize: 50,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/ids-optimized`,
        BODY: JSON.stringify({ 
          points: randomPoints(50),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },

    // ── Batch Size 100 ───────────────────────────────────────────────────────
    {
      label: "batch-100_full_vus=10",
      vus: 10,
      batchSize: 100,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/full`,
        BODY: JSON.stringify({ 
          points: randomPoints(100),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-100_ids-only_vus=10",
      vus: 10,
      batchSize: 100,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/ids-only`,
        BODY: JSON.stringify({ 
          points: randomPoints(100),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-100_ids-optimized_vus=10",
      vus: 10,
      batchSize: 100,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/10/ids-optimized`,
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
