#!/usr/bin/env node

/**
 * Accuracy test for exp-16: Verify contains and covers endpoints
 *
 * Tests that:
 * 1. Interior points return identical results for both predicates
 * 2. Points on boundaries may differ: ST_Contains excludes them, ST_Covers includes them
 */

import path from "path";
import { fileURLToPath } from "url";
import { randomPoints } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
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

async function testAccuracy() {
  console.log("Testing accuracy with interior and boundary points...\n");

  // Test with different batch sizes
  const testSizes = [1, 10, 100, 500];

  for (const size of testSizes) {
    // Generate points ONCE and reuse for both endpoints
    const points = randomPoints(size);

    // Call contains endpoint
    const containsRes = await fetch(`${BASE_URL}/exp/14/contains`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    });

    if (!containsRes.ok) {
      console.error(
        `Contains failed for size ${size}:`,
        await containsRes.text()
      );
      continue;
    }

    const containsData = (await containsRes.json()) as HierarchyResult;

    // Call covers endpoint
    const coversRes = await fetch(`${BASE_URL}/exp/14/covers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    });

    if (!coversRes.ok) {
      console.error(
        `Covers failed for size ${size}:`,
        await coversRes.text()
      );
      continue;
    }

    const coversData = (await coversRes.json()) as HierarchyResult;

    // Compare results
    let identicalResults = 0;
    let coversHasExtra = 0;
    let containsHasExtra = 0;

    for (let i = 0; i < containsData.results.length; i++) {
      const containsHierarchy = containsData.results[i].hierarchy;
      const coversHierarchy = coversData.results[i].hierarchy;

      const containsJson = JSON.stringify(containsHierarchy);
      const coversJson = JSON.stringify(coversHierarchy);

      if (containsJson === coversJson) {
        identicalResults++;
      } else if (coversHierarchy.length > containsHierarchy.length) {
        coversHasExtra++;
        if (coversHasExtra <= 2) {
          console.warn(
            `  Index ${i}: ST_Covers found boundary matches ST_Contains missed`
          );
          console.warn(
            `    Contains: ${containsHierarchy.length} matches, Covers: ${coversHierarchy.length} matches`
          );
        }
      } else if (containsHierarchy.length > coversHierarchy.length) {
        containsHasExtra++;
      }
    }

    const identicalPct = (
      (identicalResults / containsData.results.length) *
      100
    ).toFixed(2);
    console.log(
      `✓ Size ${size}: ${identicalResults}/${containsData.results.length} identical (${identicalPct}%)`
    );

    if (coversHasExtra > 0) {
      console.log(
        `  ℹ ST_Covers found ${coversHasExtra} boundary matches (expected)`
      );
    }
    if (containsHasExtra > 0) {
      console.log(
        `  ⚠ ST_Contains found ${containsHasExtra} extra matches (unexpected)`
      );
    }
  }

  console.log("\n✓ Accuracy test complete");
}

testAccuracy().catch(console.error);
