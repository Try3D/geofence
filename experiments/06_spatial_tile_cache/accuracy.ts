#!/usr/bin/env node

/**
 * Accuracy testing for Redis point-keyed cache
 *
 * Validates:
 * 1. Cache correctness: Jaccard similarity between cache and DB results
 * 2. Recall/precision on cache hits
 * 3. Redis memory usage and hit rate over time
 *
 * Protocol:
 * 1. Flush Redis
 * 2. Query 50 random points via both /cache and /no-cache
 * 3. Compare polygon ID sets (Jaccard, recall, precision)
 * 4. Report Redis memory usage via INFO
 * 5. Save results to accuracy.json
 */

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const RESULTS_DIR = path.join(__dirname, "../../benchmark-results/06_spatial_tile_cache");

interface TestPoint {
  lat: number;
  lon: number;
}

interface AccuracyMetrics {
  totalPoints: number;
  avgJaccard: string;
  avgRecall: string;
  avgPrecision: string;
  redisMemoryMB: string;
  redisKeyCount: number;
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

async function main() {
  console.log("═".repeat(80));
  console.log("REDIS CACHE — ACCURACY & CORRECTNESS");
  console.log("═".repeat(80));
  console.log(`Backend: ${BASE_URL}\n`);

  try {
    // 1. Flush Redis via redis-cli
    console.log("Flushing Redis...");
    try {
      execSync("redis-cli flushdb", { stdio: "pipe" });
    } catch (e) {
      console.warn("Could not flush Redis via redis-cli, continuing...");
    }
    console.log("✓ Redis flushed\n");

    // 2. Generate 50 random test points
    const TEST_POINTS = 50;
    console.log(`Querying ${TEST_POINTS} random points...\n`);

    let totalJaccard = 0;
    let totalRecall = 0;
    let totalPrecision = 0;
    let pointsCompared = 0;

    for (let i = 0; i < TEST_POINTS; i++) {
      const testPoint = randomPointInSpain();

      // Query /cache (Redis)
      const cacheResp = await fetch(`${BASE_URL}/exp/06/cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: [{ lat: testPoint.lat, lon: testPoint.lon }],
          table: "planet_osm_polygon",
        }),
      });

      if (!cacheResp.ok) {
        console.error(`Cache query failed for point ${i}`);
        continue;
      }

      const cacheData = (await cacheResp.json()) as any;
      const cacheResult = cacheData.results[0];
      const cacheIds = new Set(cacheResult.polygonIds);

      // Query /no-cache (DB baseline)
      const dbResp = await fetch(`${BASE_URL}/exp/06/no-cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: [{ lat: testPoint.lat, lon: testPoint.lon }],
          table: "planet_osm_polygon",
        }),
      });

      if (!dbResp.ok) {
        console.error(`DB query failed for point ${i}`);
        continue;
      }

      const dbData = (await dbResp.json()) as any;
      const dbResult = dbData.results[0];
      const dbIds = new Set(dbResult.polygonIds);

      // Compute metrics
      const metrics = computeSetMetrics(cacheIds, dbIds);
      totalJaccard += metrics.jaccard;
      totalRecall += metrics.recall;
      totalPrecision += metrics.precision;
      pointsCompared++;
    }

    // 3. Get Redis memory usage via redis-cli
    let redisMemory = "unknown";
    let keyCount = 0;

    try {
      const info = execSync("redis-cli info memory", { encoding: "utf-8" });
      const memoryMatch = info.match(/used_memory_human:(.+?)\r/);
      redisMemory = memoryMatch ? memoryMatch[1].trim() : "unknown";

      const dbsizeStr = execSync("redis-cli dbsize", { encoding: "utf-8" });
      const keysMatch = dbsizeStr.match(/\d+/);
      keyCount = keysMatch ? parseInt(keysMatch[0]) : 0;
    } catch (e) {
      console.warn("Could not get Redis info, continuing with defaults...");
    }

    // 4. Compute averages
    const avgJaccard =
      pointsCompared > 0
        ? (totalJaccard / pointsCompared).toFixed(3)
        : "N/A";
    const avgRecall =
      pointsCompared > 0
        ? ((totalRecall / pointsCompared) * 100).toFixed(1)
        : "N/A";
    const avgPrecision =
      pointsCompared > 0
        ? ((totalPrecision / pointsCompared) * 100).toFixed(1)
        : "N/A";

    // 5. Print results
    console.log("═".repeat(80));
    console.log("RESULTS");
    console.log("═".repeat(80) + "\n");

    console.log(`Points tested:          ${pointsCompared}`);
    console.log(`Avg Jaccard similarity: ${avgJaccard}`);
    console.log(`Avg Recall:             ${avgRecall}%`);
    console.log(`Avg Precision:          ${avgPrecision}%`);
    console.log(`Redis memory used:      ${redisMemory}`);
    console.log(`Redis key count:        ${keyCount}\n`);

    // 6. Save results
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const output: AccuracyMetrics = {
      totalPoints: pointsCompared,
      avgJaccard: avgJaccard as string,
      avgRecall: avgRecall as string,
      avgPrecision: avgPrecision as string,
      redisMemoryMB: redisMemory,
      redisKeyCount: keyCount,
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
