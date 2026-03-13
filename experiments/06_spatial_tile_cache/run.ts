#!/usr/bin/env node

/**
 * Benchmarks spatial tile cache with different proximity radii
 *
 * Hypothesis: Cache hits should skip DB queries entirely, providing
 * measurable latency gains at the cost of some accuracy.
 *
 * Tests:
 *   1. /exp/06/no-cache — baseline, direct DB query (all 1000 points)
 *   2. /exp/06/cache-1km — proximity cache, 1km radius
 *   3. /exp/06/cache-3km — proximity cache, 3km radius
 *   4. /exp/06/cache-5km — proximity cache, 5km radius
 *
 * Each endpoint returns cacheStats showing hit rate, average hit latency,
 * average miss (DB query) latency, and total request latency.
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Spatial Tile Cache — Proximity Radius Variants",
  resultsDir: path.join(ROOT, "benchmark-results", "06_spatial_tile_cache"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Baseline: No Cache ────────────────────────────────────────────────
    {
      label: "no-cache_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/no-cache`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    // ── Cache with 1km Proximity Radius ────────────────────────────────────
    {
      label: "cache-1km_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache-1km`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    // ── Cache with 3km Proximity Radius ────────────────────────────────────
    {
      label: "cache-3km_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache-3km`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    // ── Cache with 5km Proximity Radius ────────────────────────────────────
    {
      label: "cache-5km_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache-5km`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
  ],
});

await bench.run();
