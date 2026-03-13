#!/usr/bin/env node

/**
 * Accuracy test for exp-12: Verify baseline and native endpoints return identical results
 */

import path from "path";
import { fileURLToPath } from "url";
import { randomPoints } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

interface TestPoint {
  lat: number;
  lon: number;
}

async function testAccuracy() {
  // Test with different batch sizes
  const testSizes = [1, 10, 100, 500];

  for (const size of testSizes) {
    // Generate points ONCE and reuse for both endpoints
    const points = randomPoints(size);

    // Call baseline endpoint with same points
    const baselineRes = await fetch(`${BASE_URL}/exp/12/baseline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    });

    if (!baselineRes.ok) {
      console.error(
        `Baseline failed for size ${size}:`,
        await baselineRes.text()
      );
      continue;
    }

    const baselineData = (await baselineRes.json()) as {
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
    };

    // Call native endpoint
    const nativeRes = await fetch(`${BASE_URL}/exp/12/native`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    });

    if (!nativeRes.ok) {
      console.error(`Native failed for size ${size}:`, await nativeRes.text());
      continue;
    }

    const nativeData = (await nativeRes.json()) as {
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
    };

    // Compare results
    let matches = 0;
    let mismatches = 0;

    for (let i = 0; i < baselineData.results.length; i++) {
      const baselineHierarchy = baselineData.results[i].hierarchy;
      const nativeHierarchy = nativeData.results[i].hierarchy;

      // Deep comparison
      const baselineJson = JSON.stringify(baselineHierarchy);
      const nativeJson = JSON.stringify(nativeHierarchy);

      if (baselineJson === nativeJson) {
        matches++;
      } else {
        mismatches++;
        if (mismatches <= 3) {
          console.warn(`\nMismatch at index ${i}:`);
          console.warn("Baseline:", baselineJson);
          console.warn("Native:  ", nativeJson);
        }
      }
    }

    const matchPct = ((matches / baselineData.results.length) * 100).toFixed(2);
    console.log(
      `✓ Size ${size}: ${matches}/${baselineData.results.length} matches (${matchPct}%)`
    );

    if (mismatches > 0) {
      console.warn(`  ⚠ ${mismatches} mismatches detected`);
    }
  }

  console.log("\n✓ Accuracy test complete");
}

testAccuracy().catch(console.error);
