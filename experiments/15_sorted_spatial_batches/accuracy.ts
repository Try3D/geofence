#!/usr/bin/env node

/**
 * Accuracy test for exp-17: Verify unsorted and geohash-sorted endpoints
 * return identical results for the same input points.
 *
 * The sorting is purely an application-layer optimization — the SQL query
 * is identical. Results must be returned in original index order regardless
 * of how points were sent to the database.
 */

import path from "path";
import { fileURLToPath } from "url";
import { randomPoints } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

interface HierarchyResult {
  count: number;
  results: Array<{
    idx: number;
    hierarchy: Array<{
      id: number | null;
      osm_id: number;
      name: string;
      admin_level: number;
      depth: number;
    }>;
  }>;
}

async function post(url: string, points: unknown): Promise<HierarchyResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<HierarchyResult>;
}

async function testAccuracy() {
  console.log("exp-17 accuracy: verifying unsorted === geohash-sorted results\n");

  const testSizes = [1, 10, 100, 500, 1000];

  let allPassed = true;

  for (const size of testSizes) {
    const points = randomPoints(size);

    const [unsortedData, sortedData] = await Promise.all([
      post(`${BASE_URL}/exp/15/unsorted`, points),
      post(`${BASE_URL}/exp/15/geohash-sorted`, points),
    ]);

    let mismatches = 0;
    for (let i = 0; i < unsortedData.results.length; i++) {
      const a = JSON.stringify(unsortedData.results[i].hierarchy);
      const b = JSON.stringify(sortedData.results[i].hierarchy);
      if (a !== b) {
        mismatches++;
        if (mismatches <= 3) {
          console.error(`  Mismatch at index ${i}:`);
          console.error(`    unsorted:       ${a}`);
          console.error(`    geohash-sorted: ${b}`);
        }
      }
    }

    if (mismatches === 0) {
      console.log(`✓ size=${size}: all ${size} results identical`);
    } else {
      console.error(`✗ size=${size}: ${mismatches}/${size} mismatches`);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log("\n✓ All accuracy checks passed — sorting is result-transparent");
  } else {
    console.error("\n✗ Accuracy failures detected");
    process.exit(1);
  }
}

testAccuracy().catch((err) => {
  console.error(err);
  process.exit(1);
});
