#!/usr/bin/env node

/**
 * Benchmarks Redis point-keyed cache vs no-cache with truly random points
 *
 * Test Design:
 * - Two variants: /exp/06/cache (Redis → PG) and /exp/06/no-cache (PG only)
 * - k6 sends 1000 fresh random points per iteration (GENERATE_BODY=true)
 * - Cache key: lat/lon rounded to 4dp (~11m grid)
 * - TTL: 3600s (1 hour)
 * - Expected: hit rate starts ~0%, grows as cache fills over the 60s test
 *
 * Metrics: hit rate, latency (cache vs DB), throughput, accuracy (Jaccard)
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Spatial Cache — Redis vs No-Cache (random points)",
  resultsDir: path.join(ROOT, "benchmark-results", "06_spatial_tile_cache"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Baseline: No Cache (direct DB query) ─────────────────────────────────
    {
      label: "no-cache_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/no-cache`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },

    // ── Cache: Redis key-value (lat/lon @ 4dp) ───────────────────────────────
    {
      label: "redis-cache_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    },
  ],
});

await bench.run();
