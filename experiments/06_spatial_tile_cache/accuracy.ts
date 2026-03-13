#!/usr/bin/env node

/**
 * Accuracy testing for spatial tile cache
 *
 * Measures correctness of proximity cache hits using polygon set similarity.
 * Since each point can belong to multiple geofences, accuracy is measured as:
 * - Jaccard similarity = |cache ∩ DB| / |cache ∪ DB|
 * - Recall = |cache ∩ DB| / |DB| (fraction of true polygons returned)
 * - Precision = |cache ∩ DB| / |cache| (fraction of returned polygons correct)
 *
 * Protocol:
 * 1. Clear all caches
 * 2. Warm each cache: POST 300 random seed points to each variant
 * 3. For each variant (1km, 3km, 5km):
 *    - Generate 200 test points at random distance 0..maxRadius from seed points
 *    - Query cache endpoint + query no-cache for ground truth
 *    - Compute polygon set similarity metrics across all hits
 * 4. Report hit rate, Jaccard, recall, precision per variant
 */

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const RESULTS_DIR = path.join(__dirname, "../../benchmark-results/06_spatial_tile_cache");

interface TestPoint {
  lat: number;
  lon: number;
}

interface VariantMetrics {
  radius: string;
  radiusM: number;
  hitCount: number;
  missCount: number;
  hitRate: string;
  avgJaccard: string;
  avgRecall: string;
  avgPrecision: string;
  avgCacheLatencyMs: string;
  avgDbLatencyMs: string;
}

interface AccuracyResult {
  timestamp: string;
  variants: VariantMetrics[];
}

// Haversine distance
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Random points in Spain bounds
function randomPointInSpain(): TestPoint {
  const minLat = 36.0;
  const maxLat = 43.8;
  const minLon = -9.5;
  const maxLon = 3.3;
  return {
    lat: minLat + Math.random() * (maxLat - minLat),
    lon: minLon + Math.random() * (maxLon - minLon),
  };
}

// Generate point at distance from origin
function pointAtDistance(origin: TestPoint, distanceM: number): TestPoint {
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

// Compute Jaccard, recall, precision
function computeSetMetrics(
  cacheIds: Set<string>,
  dbIds: Set<string>
): {
  jaccard: number;
  recall: number;
  precision: number;
} {
  const intersection = new Set([...cacheIds].filter((x) => dbIds.has(x)));
  const union = new Set([...cacheIds, ...dbIds]);

  const jaccard = union.size > 0 ? intersection.size / union.size : 1.0;
  const recall = dbIds.size > 0 ? intersection.size / dbIds.size : 1.0;
  const precision = cacheIds.size > 0 ? intersection.size / cacheIds.size : 1.0;

  return { jaccard, recall, precision };
}

async function testVariant(
  endpoint: string,
  radiusM: number,
  seedPoints: TestPoint[]
): Promise<VariantMetrics> {
  const TEST_POINTS = 200;
  const radiusStr = `${(radiusM / 1000).toFixed(0)}km`;

  console.log(`  Testing ${endpoint} (${radiusStr})...`);

  let hitCount = 0;
  let missCount = 0;
  let totalJaccard = 0;
  let totalRecall = 0;
  let totalPrecision = 0;
  let totalCacheLatency = 0;
  let totalDbLatency = 0;

  // Generate test points around seed points
  const testPoints: TestPoint[] = [];
  for (let i = 0; i < TEST_POINTS; i++) {
    const seedPoint = seedPoints[Math.floor(Math.random() * seedPoints.length)];
    const randomDist = Math.random() * radiusM;
    testPoints.push(pointAtDistance(seedPoint, randomDist));
  }

  // Query each test point
  for (const testPoint of testPoints) {
    // Query cache variant
    const cacheResp = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        points: [{ lat: testPoint.lat, lon: testPoint.lon }],
        table: "planet_osm_polygon",
      }),
    });

    if (!cacheResp.ok) continue;

    const cacheData = (await cacheResp.json()) as any;
    const cacheResult = cacheData.results[0];
    const cacheIds = new Set(cacheResult.polygonIds);

    // Query baseline (no-cache) for ground truth
    const dbResp = await fetch(`${BASE_URL}/exp/06/no-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        points: [{ lat: testPoint.lat, lon: testPoint.lon }],
        table: "planet_osm_polygon",
      }),
    });

    if (!dbResp.ok) continue;

    const dbData = (await dbResp.json()) as any;
    const dbResult = dbData.results[0];
    const dbIds = new Set(dbResult.polygonIds);

    // Check if cache hit or miss
    if (
      cacheResult.source === "cache-exact" ||
      cacheResult.source === "cache-proximity"
    ) {
      hitCount++;
      if (cacheResp.ok && cacheData.cacheStats) {
        if (cacheResult.source === "cache-exact") {
          totalCacheLatency +=
            cacheData.cacheStats.avgCacheHitLatencyMs || 0;
        } else {
          totalCacheLatency +=
            cacheData.cacheStats.avgCacheHitLatencyMs || 0;
        }
      }

      // Compute metrics only for hits
      const metrics = computeSetMetrics(cacheIds, dbIds);
      totalJaccard += metrics.jaccard;
      totalRecall += metrics.recall;
      totalPrecision += metrics.precision;
    } else {
      missCount++;
      if (dbData.cacheStats) {
        totalDbLatency += dbData.cacheStats.avgDbQueryLatencyMs || 0;
      }
    }
  }

  const totalTests = hitCount + missCount;
  const hitRate =
    totalTests > 0
      ? ((hitCount / totalTests) * 100).toFixed(2)
      : "0.00";
  const avgJaccard =
    hitCount > 0 ? (totalJaccard / hitCount).toFixed(3) : "N/A";
  const avgRecall =
    hitCount > 0
      ? ((totalRecall / hitCount) * 100).toFixed(1)
      : "N/A";
  const avgPrecision =
    hitCount > 0
      ? ((totalPrecision / hitCount) * 100).toFixed(1)
      : "N/A";
  const avgCacheLatency =
    hitCount > 0 ? (totalCacheLatency / hitCount).toFixed(2) : "0.00";
  const avgDbLatency =
    missCount > 0 ? (totalDbLatency / missCount).toFixed(2) : "0.00";

  return {
    radius: radiusStr,
    radiusM,
    hitCount,
    missCount,
    hitRate,
    avgJaccard: avgJaccard as string,
    avgRecall: avgRecall as string,
    avgPrecision: avgPrecision as string,
    avgCacheLatencyMs: avgCacheLatency,
    avgDbLatencyMs: avgDbLatency,
  };
}

async function main() {
  console.log("═".repeat(80));
  console.log(
    "SPATIAL TILE CACHE — ACCURACY vs PROXIMITY RADIUS TRADEOFF"
  );
  console.log("═".repeat(80));
  console.log(`Backend: ${BASE_URL}\n`);

  try {
    // Clear all caches
    console.log("Clearing all caches...");
    await fetch(`${BASE_URL}/exp/06/clear-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // Warm caches with seed points
    console.log(
      "Warming caches with 300 seed points...\n"
    );
    const seedPoints = Array.from({ length: 300 }, () =>
      randomPointInSpain()
    );

    for (const endpoint of ["/exp/06/cache-1km", "/exp/06/cache-3km", "/exp/06/cache-5km"]) {
      const resp = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: seedPoints.map((p) => ({ lat: p.lat, lon: p.lon })),
          table: "planet_osm_polygon",
        }),
      });
      if (!resp.ok) {
        console.error(`Failed to warm cache for ${endpoint}`);
      }
    }

    console.log("\nTesting variants:\n");

    // Test each variant
    const results: VariantMetrics[] = [];
    results.push(await testVariant("/exp/06/cache-1km", 1000, seedPoints));
    results.push(await testVariant("/exp/06/cache-3km", 3000, seedPoints));
    results.push(await testVariant("/exp/06/cache-5km", 5000, seedPoints));

    // Print results
    console.log("\n" + "═".repeat(80));
    console.log("ACCURACY RESULTS");
    console.log("═".repeat(80) + "\n");

    console.log(
      String("Radius").padEnd(10) +
        String("Hit Rate").padEnd(12) +
        String("Jaccard").padEnd(12) +
        String("Recall").padEnd(12) +
        String("Precision").padEnd(12) +
        String("Hit Lat (ms)").padEnd(14) +
        String("DB Lat (ms)").padEnd(14)
    );
    console.log("-".repeat(80));

    for (const result of results) {
      console.log(
        String(result.radius).padEnd(10) +
          String(`${result.hitRate}%`).padEnd(12) +
          String(result.avgJaccard).padEnd(12) +
          String(`${result.avgRecall}%`).padEnd(12) +
          String(`${result.avgPrecision}%`).padEnd(12) +
          String(result.avgCacheLatencyMs).padEnd(14) +
          String(result.avgDbLatencyMs).padEnd(14)
      );
    }

    console.log();

    // Save results
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const output: AccuracyResult = {
      timestamp: new Date().toISOString(),
      variants: results,
    };
    fs.writeFileSync(
      path.join(RESULTS_DIR, "accuracy.json"),
      JSON.stringify(output, null, 2)
    );

    console.log(
      `✓ Results saved to benchmark-results/06_spatial_tile_cache/accuracy.json\n`
    );
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
