#!/usr/bin/env node

/**
 * Accuracy validation for exp-07 bbox filter optimization
 * 
 * Verifies that all three endpoints return identical results for 100 random test points.
 * This ensures the bbox filter optimization doesn't introduce false negatives or false positives.
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const TEST_POINTS = 100;

// Generate random points in France
function generateRandomPoints(count: number): Array<{ lon: number; lat: number }> {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lon: Math.random() * 11 - 3, // -3 to 8 degrees
      lat: Math.random() * 10 + 41, // 41 to 51 degrees
    });
  }
  return points;
}

// Fetch results from an endpoint
async function fetchResults(
  endpoint: string,
  points: Array<{ lon: number; lat: number }>
): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/exp/07/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });

  if (!response.ok) {
    throw new Error(
      `Endpoint ${endpoint} failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

// Normalize and compare results (order-independent)
function resultsMatch(result1: any, result2: any): boolean {
  if (result1.count !== result2.count) return false;
  if (result1.results.length !== result2.results.length) return false;

  for (let i = 0; i < result1.results.length; i++) {
    const r1 = result1.results[i];
    const r2 = result2.results[i];

    if (r1.idx !== r2.idx) return false;
    if (r1.matches.length !== r2.matches.length) return false;

    // Sort matches by osm_id for comparison (order might differ)
    const sorted1 = [...r1.matches].sort((a, b) =>
      a.osm_id.localeCompare(b.osm_id)
    );
    const sorted2 = [...r2.matches].sort((a, b) =>
      a.osm_id.localeCompare(b.osm_id)
    );

    for (let j = 0; j < sorted1.length; j++) {
      if (
        sorted1[j].osm_id !== sorted2[j].osm_id ||
        sorted1[j].name !== sorted2[j].name
      ) {
        return false;
      }
    }
  }

  return true;
}

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log("  Accuracy Validation: Bounding Box Filter Optimization (exp-07)");
  console.log(`${"=".repeat(70)}\n`);

  try {
    const testPoints = generateRandomPoints(TEST_POINTS);
    console.log(`Testing with ${TEST_POINTS} random points in France...\n`);

    // Fetch results from all three endpoints
    console.log("  → Fetching results from batch-no-bbox...");
    const noBbox = await fetchResults("batch-no-bbox", testPoints);
    console.log(`    ✓ Got ${noBbox.count} results`);

    console.log("  → Fetching results from batch-with-bbox...");
    const withBbox = await fetchResults("batch-with-bbox", testPoints);
    console.log(`    ✓ Got ${withBbox.count} results`);

    console.log("  → Fetching results from batch-with-bbox-indexed...");
    const withBboxIndexed = await fetchResults(
      "batch-with-bbox-indexed",
      testPoints
    );
    console.log(`    ✓ Got ${withBboxIndexed.count} results\n`);

    // Compare results
    console.log("Comparing results...\n");

    const match1vs2 = resultsMatch(noBbox, withBbox);
    const match1vs3 = resultsMatch(noBbox, withBboxIndexed);
    const match2vs3 = resultsMatch(withBbox, withBboxIndexed);

    console.log(
      `  batch-no-bbox vs batch-with-bbox:         ${
        match1vs2 ? "✅ MATCH" : "❌ MISMATCH"
      }`
    );
    console.log(
      `  batch-no-bbox vs batch-with-bbox-indexed: ${
        match1vs3 ? "✅ MATCH" : "❌ MISMATCH"
      }`
    );
    console.log(
      `  batch-with-bbox vs batch-with-bbox-indexed: ${
        match2vs3 ? "✅ MATCH" : "❌ MISMATCH"
      }\n`);

    if (match1vs2 && match1vs3 && match2vs3) {
      console.log(
        "✅ SUCCESS: All three endpoints return identical results!\n"
      );
      console.log("Conclusion: Bounding box filters do NOT introduce false positives or false negatives.\n");
      process.exit(0);
    } else {
      console.log(
        "❌ FAILURE: Endpoints return different results!\n"
      );
      console.log("This indicates a bug in the bbox filter optimization.\n");
      process.exit(1);
    }
  } catch (error) {
    console.error("Error during accuracy validation:", error);
    process.exit(1);
  }
}

main();
