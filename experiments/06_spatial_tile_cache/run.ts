#!/usr/bin/env node

/**
 * Benchmarks spatial tile cache with different proximity radii
 *
 * Test Design:
 * - Warm each cache with 500 seed points
 * - Each variant sends batches of 1000 points clustered around the warm seeds
 * - Points are generated consistently per variant (same seeds, same proximity distribution)
 * - Measures: throughput, latency, and realistic cache hit rates
 *
 * Tests:
 *   1. /exp/06/no-cache — baseline, direct DB query (1000 random global points)
 *   2. /exp/06/cache-1km — 1km proximity cache, points within 1km of seeds
 *   3. /exp/06/cache-3km — 3km proximity cache, points within 3km of seeds
 *   4. /exp/06/cache-5km — 5km proximity cache, points within 5km of seeds
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

/**
 * Generate point at distance from origin
 */
function pointAtDistance(origin: { lat: number; lon: number }, distanceM: number) {
  const bearing = Math.random() * 360;
  const R = 6371000;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lon1 = (origin.lon * Math.PI) / 180;
  const brg = (bearing * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceM / R) +
      Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(brg)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(distanceM / R) * Math.cos(lat1),
      Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (lon2 * 180) / Math.PI,
  };
}

/**
 * Clear all caches before benchmarking
 */
async function clearAllCaches() {
  console.log("🗑️  Clearing all caches...\n");

  try {
    const response = await fetch(`${BASE_URL}/exp/06/clear-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      console.log("✓ All caches cleared\n");
    }
  } catch (error) {
    console.error(`✗ Failed to clear caches: ${error}`);
  }
}

/**
 * Warm up caches before benchmarking
 * Send 500 seed points to each variant to populate cache
 */
async function warmUpCaches() {
  console.log("📌 Pre-warming caches with 500 seed points...\n");

  const endpoints = ["/exp/06/cache-1km", "/exp/06/cache-3km", "/exp/06/cache-5km"];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: randomPoints(500),
          table: "planet_osm_polygon",
        }),
      });

      if (response.ok) {
        console.log(`✓ ${endpoint}: cache warmed`);
      }
    } catch (error) {
      console.error(`✗ ${endpoint}: ${error}`);
    }
  }
  console.log("");
}

// Clear and warm up caches before running benchmarks
await clearAllCaches();
await warmUpCaches();

// Generate seed points for consistent test workloads
const seedPoints = randomPoints(100);

// Generate test points: same seeds, different nearby points per batch
const noCache_Points = randomPoints(1000); // Fully random (no locality)
const cache1km_Points = Array.from({ length: 1000 }, (_, i) =>
  pointAtDistance(seedPoints[i % seedPoints.length], Math.random() * 1000)
);
const cache3km_Points = Array.from({ length: 1000 }, (_, i) =>
  pointAtDistance(seedPoints[i % seedPoints.length], Math.random() * 3000)
);
const cache5km_Points = Array.from({ length: 1000 }, (_, i) =>
  pointAtDistance(seedPoints[i % seedPoints.length], Math.random() * 5000)
);

const bench = new Benchmark({
  name: "Spatial Tile Cache — Proximity Radius Variants (Clustered Workload)",
  resultsDir: path.join(ROOT, "benchmark-results", "06_spatial_tile_cache"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Baseline: No Cache (fully random points) ────────────────────────────
    {
      label: "no-cache_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/no-cache`,
        BODY: JSON.stringify({ points: noCache_Points }),
        // No GENERATE_BODY: reuse same points for all iterations (realistic for batch)
      },
    },

    // ── Cache with 1km Proximity Radius (points clustered to cache seeds) ────
    {
      label: "cache-1km_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache-1km`,
        BODY: JSON.stringify({ points: cache1km_Points }),
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
        BODY: JSON.stringify({ points: cache3km_Points }),
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
        BODY: JSON.stringify({ points: cache5km_Points }),
      },
    },
  ],
});

await bench.run();
