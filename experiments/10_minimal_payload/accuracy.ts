const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

// Generate random points in France
function generateRandomPoints(count: number): Array<{ lon: number; lat: number }> {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lon: -5 + Math.random() * 10,
      lat: 41 + Math.random() * 9,
    });
  }
  return points;
}

async function testVariant(
  endpoint: string,
  points: Array<{ lon: number; lat: number }>
): Promise<any> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points,
      table: "planet_osm_polygon",
      limit: 20,
    }),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

function areResultsEqual(
  results1: any[],
  results2: any[]
): boolean {
  if (results1.length !== results2.length) return false;

  for (let i = 0; i < results1.length; i++) {
    const r1 = results1[i];
    const r2 = results2[i];

    if (r1.idx !== r2.idx) return false;
    if ((r1.results || r1).length !== (r2.results || r2).length) return false;

    const set1 = new Set((r1.results || r1).map((m: any) => m.osm_id));
    const set2 = new Set((r2.results || r2).map((m: any) => m.osm_id));

    if (set1.size !== set2.size) return false;
    for (const id of set1) {
      if (!set2.has(id)) return false;
    }
  }

  return true;
}

async function main() {
  console.log(
    "=" + "=".repeat(79) +
      "\n  Accuracy Validation: Minimal Payload Optimization (exp-12)\n" +
      "=" + "=".repeat(79)
  );

  const batchSizes = [10, 50, 100];

  for (const batchSize of batchSizes) {
    console.log(`\n📊 Testing with ${batchSize} random points in France...\n`);
    const points = generateRandomPoints(batchSize);

    try {
      process.stdout.write("  → Fetching results from full... ");
      const full = await testVariant("/exp/12/full", points);
      console.log(`✓ Got ${(full.results || full).length} results`);

      process.stdout.write("  → Fetching results from ids-only... ");
      const idsOnly = await testVariant("/exp/12/ids-only", points);
      console.log(`✓ Got ${(idsOnly.results || idsOnly).length} results`);

      process.stdout.write("  → Fetching results from ids-optimized... ");
      const idsOptimized = await testVariant("/exp/12/ids-optimized", points);
      console.log(`✓ Got ${(idsOptimized.results || idsOptimized).length} results`);

      console.log("\nComparing results...\n");

      const fullVsIds = areResultsEqual(full.results || full, idsOnly.results || idsOnly);
      const fullVsOptimized = areResultsEqual(full.results || full, idsOptimized.results || idsOptimized);
      const idsVsOptimized = areResultsEqual(idsOnly.results || idsOnly, idsOptimized.results || idsOptimized);

      console.log(
        `  full vs ids-only:         ${
          fullVsIds ? "✅ MATCH" : "❌ MISMATCH"
        }`
      );
      console.log(
        `  full vs ids-optimized:    ${
          fullVsOptimized ? "✅ MATCH" : "❌ MISMATCH"
        }`
      );
      console.log(
        `  ids-only vs ids-optimized: ${
          idsVsOptimized ? "✅ MATCH" : "❌ MISMATCH"
        }`
      );

      if (!fullVsIds || !fullVsOptimized || !idsVsOptimized) {
        console.log("\n❌ FAILURE: Results do not match!");
        process.exit(1);
      }
    } catch (err) {
      console.error(`\n❌ Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  console.log(
    "\n✅ SUCCESS: All batch sizes return identical results across all variants!\n"
  );
  console.log("Conclusion: Payload optimizations do NOT introduce false positives or false negatives.\n");
}

main().catch(console.error);
