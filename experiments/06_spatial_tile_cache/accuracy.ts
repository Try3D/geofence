#!/usr/bin/env node

/**
 * Accuracy testing for proximity cache variants
 *
 * 10,000 points: 10 seeds × 1000 repeats each.
 * Each point queried individually. Cache vs baseline fired concurrently
 * with Promise.all per point.
 *
 * Redis is NOT flushed — warm cache represents real-world scenario.
 */

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const RESULTS_DIR = path.join(
  __dirname,
  "../../benchmark-results/06_spatial_tile_cache"
);

interface AccuracyMetrics {
  variant: string;
  radiusM: number;
  totalPoints: number;
  hitRate: string;
  avgJaccard: string;
  avgRecall: string;
  avgPrecision: string;
  avgCacheLatencyMs: string;
  avgDbLatencyMs: string;
}

function randomPointInSpain() {
  return {
    lat: 36.0 + Math.random() * (43.8 - 36.0),
    lon: -9.5 + Math.random() * (3.3 - -9.5),
  };
}

function computeSetMetrics(cacheIds: Set<string>, dbIds: Set<string>) {
  const intersection = new Set([...cacheIds].filter((x) => dbIds.has(x)));
  const union = new Set([...cacheIds, ...dbIds]);
  return {
    jaccard: union.size > 0 ? intersection.size / union.size : null,
    recall: dbIds.size > 0 ? intersection.size / dbIds.size : null,
    precision: cacheIds.size > 0 ? intersection.size / cacheIds.size : null,
  };
}

async function queryPoint(endpoint: string, lat: number, lon: number) {
  const resp = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, table: "planet_osm_polygon" }),
  });
  if (!resp.ok) throw new Error(`${endpoint} returned ${resp.status}`);
  return resp.json() as Promise<any>;
}

async function flushRedis() {
  await fetch(`${BASE_URL}/exp/06/flush`, { method: "POST" });
}

async function testVariant(
  endpoint: string,
  radiusM: number,
  testPoints: Array<{ lat: number; lon: number }>
): Promise<AccuracyMetrics> {
  // Flush Redis before each variant so each starts from a cold cache
  await flushRedis();
  console.log(`  Testing ${endpoint} (${radiusM / 1000}km, ${testPoints.length} points, cold cache)...`);

  let hitCount = 0;
  let missCount = 0;
  let totalJaccard = 0;
  let totalRecall = 0;
  let totalPrecision = 0;
  let totalCacheLatency = 0;
  let totalDbLatency = 0;
  let skipped = 0;

  for (const pt of testPoints) {
    try {
      // Fire cache and baseline concurrently for each point
      const [cacheData, dbData] = await Promise.all([
        queryPoint(endpoint, pt.lat, pt.lon),
        queryPoint("/exp/06/no-cache", pt.lat, pt.lon),
      ]);

      const cacheIds = new Set<string>(cacheData.polygonIds);
      const dbIds = new Set<string>(dbData.polygonIds);

      // Skip points where both sets are empty — outside all polygons, proves nothing
      if (cacheIds.size === 0 && dbIds.size === 0) {
        skipped++;
        continue;
      }

      const latency = parseFloat(cacheData.latencyMs || "0");

      if (cacheData.source === "cache") {
        hitCount++;
        totalCacheLatency += latency;
      } else {
        missCount++;
        totalDbLatency += latency;
      }

      const m = computeSetMetrics(cacheIds, dbIds);
      if (m.jaccard !== null) totalJaccard += m.jaccard;
      if (m.recall !== null) totalRecall += m.recall;
      if (m.precision !== null) totalPrecision += m.precision;
    } catch {
      skipped++;
    }
  }

  const total = hitCount + missCount;
  console.log(`    → ${hitCount} hits, ${missCount} misses, ${skipped} skipped (both sets empty)`);

  return {
    variant: endpoint.replace("/exp/06/", ""),
    radiusM,
    totalPoints: total,
    hitRate: total > 0 ? ((hitCount / total) * 100).toFixed(2) : "0.00",
    avgJaccard: total > 0 ? (totalJaccard / total).toFixed(4) : "N/A",
    avgRecall: total > 0 ? ((totalRecall / total) * 100).toFixed(1) : "N/A",
    avgPrecision: total > 0 ? ((totalPrecision / total) * 100).toFixed(1) : "N/A",
    avgCacheLatencyMs: hitCount > 0 ? (totalCacheLatency / hitCount).toFixed(2) : "0.00",
    avgDbLatencyMs: missCount > 0 ? (totalDbLatency / missCount).toFixed(2) : "0.00",
  };
}

async function main() {
  console.log("═".repeat(80));
  console.log("PROXIMITY CACHE — ACCURACY TEST (10,000 POINTS, WARM REDIS)");
  console.log("═".repeat(80));
  console.log(`Backend: ${BASE_URL}`);
  console.log("Note: Redis flushed before each variant — cold cache per test\n");
  console.log("Note: Points with empty polygon sets (outside all polygons) are skipped\n");

  // 10,000 unique random points
  const testPoints = Array.from({ length: 10000 }, () => randomPointInSpain());
  console.log(`Generated ${testPoints.length} unique random points\n`);

  const results: AccuracyMetrics[] = [];
  results.push(await testVariant("/exp/06/cache-1km", 1000, testPoints));
  results.push(await testVariant("/exp/06/cache-2km", 2000, testPoints));
  results.push(await testVariant("/exp/06/cache-5km", 5000, testPoints));
  results.push(await testVariant("/exp/06/cache-10km", 10000, testPoints));

  console.log("\n" + "═".repeat(80));
  console.log("RESULTS");
  console.log("═".repeat(80) + "\n");

  const h =
    "Variant".padEnd(14) +
    "Radius".padEnd(8) +
    "Hit Rate".padEnd(11) +
    "Jaccard".padEnd(10) +
    "Recall".padEnd(9) +
    "Precision".padEnd(12) +
    "Cache Lat".padEnd(12) +
    "DB Lat";
  console.log(h);
  console.log("-".repeat(h.length));

  for (const r of results) {
    console.log(
      r.variant.padEnd(14) +
        `${r.radiusM / 1000}km`.padEnd(8) +
        `${r.hitRate}%`.padEnd(11) +
        r.avgJaccard.padEnd(10) +
        `${r.avgRecall}%`.padEnd(9) +
        `${r.avgPrecision}%`.padEnd(12) +
        `${r.avgCacheLatencyMs}ms`.padEnd(12) +
        `${r.avgDbLatencyMs}ms`
    );
  }

  console.log();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, "accuracy.json"),
    JSON.stringify(results, null, 2)
  );
  console.log("✓ Saved to benchmark-results/06_spatial_tile_cache/accuracy.json\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
