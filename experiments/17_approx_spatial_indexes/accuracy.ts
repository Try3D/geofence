#!/usr/bin/env node
/**
 * Accuracy test for exp-17: Verify GIST, SP-GiST, and BRIN endpoints
 * return identical results for the same input points.
 *
 * SP-GiST and BRIN use different index structures, but ST_Contains is an
 * exact predicate — the index only affects which rows are fetched as candidates.
 * All three variants must return bit-for-bit identical results.
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
  console.log("exp-17 accuracy: verifying gist === spgist === brin results\n");

  const testSizes = [1, 10, 50, 200];
  let allPassed = true;

  for (const size of testSizes) {
    const points = randomPoints(size);

    const [gistData, spgistData, brinData] = await Promise.all([
      post(`${BASE_URL}/exp/17/gist`, points),
      post(`${BASE_URL}/exp/17/spgist`, points),
      post(`${BASE_URL}/exp/17/brin`, points),
    ]);

    // Sort results by idx for stable comparison
    const sortByIdx = (
      results: HierarchyResult["results"]
    ): HierarchyResult["results"] =>
      [...results].sort((a, b) => a.idx - b.idx);

    const gistSorted = sortByIdx(gistData.results);
    const spgistSorted = sortByIdx(spgistData.results);
    const brinSorted = sortByIdx(brinData.results);

    let gistVsSpgist = 0;
    let gistVsBrin = 0;

    for (let i = 0; i < gistSorted.length; i++) {
      const g = JSON.stringify(gistSorted[i].hierarchy);
      const sp = JSON.stringify(spgistSorted[i]?.hierarchy);
      const br = JSON.stringify(brinSorted[i]?.hierarchy);

      if (g !== sp) {
        gistVsSpgist++;
        if (gistVsSpgist <= 3) {
          console.error(`  gist vs spgist mismatch at index ${gistSorted[i].idx}:`);
          console.error(`    gist:   ${g}`);
          console.error(`    spgist: ${sp}`);
        }
      }
      if (g !== br) {
        gistVsBrin++;
        if (gistVsBrin <= 3) {
          console.error(`  gist vs brin mismatch at index ${gistSorted[i].idx}:`);
          console.error(`    gist: ${g}`);
          console.error(`    brin: ${br}`);
        }
      }
    }

    const passed = gistVsSpgist === 0 && gistVsBrin === 0;
    if (passed) {
      console.log(`✓ size=${size}: all ${size} results identical across gist/spgist/brin`);
    } else {
      if (gistVsSpgist > 0) {
        console.error(`✗ size=${size}: gist vs spgist — ${gistVsSpgist}/${size} mismatches`);
      }
      if (gistVsBrin > 0) {
        console.error(`✗ size=${size}: gist vs brin — ${gistVsBrin}/${size} mismatches`);
      }
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log("\n✓ All accuracy checks passed — all index types return identical results");
  } else {
    console.error("\n✗ Accuracy failures detected");
    process.exit(1);
  }
}

testAccuracy().catch((err) => {
  console.error(err);
  process.exit(1);
});
