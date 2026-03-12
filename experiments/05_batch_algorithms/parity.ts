#!/usr/bin/env node

/**
 * Parity checker for batch algorithm comparison.
 * Validates that JSON expansion, temp table, and serial LATERAL methods
 * return identical result sets for the same input.
 */

import { randomPoints } from "@geofence/profiler";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

interface BatchResult {
  idx: number;
  matches: Array<{ osm_id: string; name: string }>;
}

/**
 * Sort results for deterministic comparison
 */
function normalizeResults(results: BatchResult[]): BatchResult[] {
  return results
    .map((r) => ({
      idx: r.idx,
      matches: r.matches.slice().sort((a, b) => a.osm_id.localeCompare(b.osm_id)),
    }))
    .sort((a, b) => a.idx - b.idx);
}

/**
 * Deep equality check with detailed diff reporting
 */
function resultsEqual(a: BatchResult[], b: BatchResult[], method: string): boolean {
  if (a.length !== b.length) {
    console.error(`  ✗ ${method}: length mismatch (${a.length} vs ${b.length})`);
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    const aResult = a[i];
    const bResult = b[i];

    if (aResult.idx !== bResult.idx) {
      console.error(`  ✗ ${method}: idx mismatch at position ${i} (${aResult.idx} vs ${bResult.idx})`);
      return false;
    }

    if (aResult.matches.length !== bResult.matches.length) {
      console.error(
        `  ✗ ${method}: match count mismatch at idx ${aResult.idx} (${aResult.matches.length} vs ${bResult.matches.length})`
      );
      return false;
    }

    for (let j = 0; j < aResult.matches.length; j++) {
      if (aResult.matches[j].osm_id !== bResult.matches[j].osm_id) {
        console.error(
          `  ✗ ${method}: osm_id mismatch at idx ${aResult.idx}, match ${j} (${aResult.matches[j].osm_id} vs ${bResult.matches[j].osm_id})`
        );
        return false;
      }
      if (aResult.matches[j].name !== bResult.matches[j].name) {
        console.error(
          `  ✗ ${method}: name mismatch at idx ${aResult.idx}, match ${j} (${aResult.matches[j].name} vs ${bResult.matches[j].name})`
        );
        return false;
      }
    }
  }

  return true;
}

/**
 * Test a given batch size and table combination
 */
async function testBatch(
  batchSize: number,
  table: string = "planet_osm_polygon"
): Promise<boolean> {
  const points = randomPoints(batchSize);
  const payload = { points, table, limit: 100000 }; // Use very high limit to ensure all matches are returned

  console.log(`\n  Testing batch size ${batchSize}, table ${table}...`);

   try {
     // Call all three endpoints
     const [jsonRes, tempRes, serialRes] = await Promise.all([
       fetch(`${BASE_URL}/exp/05/batch-json`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(payload),
       }),
       fetch(`${BASE_URL}/exp/05/batch-temp`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(payload),
       }),
       fetch(`${BASE_URL}/exp/05/batch`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(payload),
       }),
     ]);

    if (!jsonRes.ok || !tempRes.ok || !serialRes.ok) {
      console.error(
        `  ✗ HTTP error: json=${jsonRes.status}, temp=${tempRes.status}, serial=${serialRes.status}`
      );
      return false;
    }

    const jsonDataRaw = (await jsonRes.json()) as any;
    const tempDataRaw = (await tempRes.json()) as any;
    const serialDataRaw = (await serialRes.json()) as any;

    // All endpoints return { count, results: [...] }
    const jsonData = (jsonDataRaw.results || []) as BatchResult[];
    const tempData = (tempDataRaw.results || []) as BatchResult[];
    const serialData = (serialDataRaw.results || []) as BatchResult[];

    // Normalize all results
    const jsonNorm = normalizeResults(jsonData);
    const tempNorm = normalizeResults(tempData);
    const serialNorm = normalizeResults(serialData);

    // Compare
    let allMatch = true;

    if (!resultsEqual(jsonNorm, tempNorm, "json vs temp")) {
      allMatch = false;
    } else {
      console.log(`  ✓ json vs temp: match`);
    }

    if (!resultsEqual(jsonNorm, serialNorm, "json vs serial")) {
      allMatch = false;
    } else {
      console.log(`  ✓ json vs serial: match`);
    }

    if (!resultsEqual(tempNorm, serialNorm, "temp vs serial")) {
      allMatch = false;
    } else {
      console.log(`  ✓ temp vs serial: match`);
    }

    return allMatch;
  } catch (err) {
    console.error(`  ✗ Error: ${err}`);
    return false;
  }
}

/**
 * Main
 */
async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("  Batch Algorithm Parity Checker");
  console.log("=".repeat(70));

  const testCases = [
    { size: 10, table: "planet_osm_polygon" },
    { size: 100, table: "planet_osm_polygon" },
    { size: 1000, table: "planet_osm_polygon" },
    { size: 100, table: "planet_osm_polygon_simple_10" },
    { size: 1000, table: "planet_osm_polygon_simple_10" },
  ];

  let passCount = 0;
  let failCount = 0;

  for (const tc of testCases) {
    const passed = await testBatch(tc.size, tc.table);
    if (passed) {
      passCount++;
    } else {
      failCount++;
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log(`${"=".repeat(70)}\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

main();
