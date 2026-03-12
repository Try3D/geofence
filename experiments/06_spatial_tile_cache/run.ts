#!/usr/bin/env node

/**
 * Benchmarks three spatial tile caching systems (Geohash, H3, Quadkey)
 * against 1000 random points with proximity reuse matching.
 *
 * Hypothesis: Tile caching will be ineffective for random/moving-object workloads
 * because each new point lands in a different tile, resulting in ~0% cache hit rate.
 *
 * Tests:
 *   1. /exp/06/batch-geohash  — Geohash-based tile caching (precision 7)
 *   2. /exp/06/batch-h3       — H3-based tile caching (resolution 8)
 *   3. /exp/06/batch-quadkey  — Quadkey-based tile caching (zoom 14)
 *
 * Each endpoint returns:
 *   {
 *     systemType: "geohash" | "h3" | "quadkey",
 *     cacheStats: {
 *       exactHits: number,
 *       proximityHits: number,
 *       misses: number,
 *       hitRate: number (percentage),
 *       proximityAccuracyRate: number (percentage),
 *       memoryUsedMB: number,
 *     },
 *     results: array of point results
 *   }
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Spatial Tile Cache Benchmark (Geohash vs H3 vs Quadkey)",
  resultsDir: path.join(ROOT, "benchmark-results", "06_spatial_tile_cache"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Geohash (precision 7) ────────────────────────────────────────────────
    {
      label: "geohash_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/batch-geohash`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    // ── H3 (resolution 8) ────────────────────────────────────────────────────
    {
      label: "h3_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/batch-h3`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    // ── Quadkey (zoom 14) ────────────────────────────────────────────────────
    {
      label: "quadkey_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/batch-quadkey`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
  ],
});

await bench.run();
