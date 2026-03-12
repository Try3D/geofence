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
    body: JSON.stringify({ points }),
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
    if (r1.matches.length !== r2.matches.length) return false;

    const set1 = new Set(r1.matches.map((m: any) => m.osm_id));
    const set2 = new Set(r2.matches.map((m: any) => m.osm_id));

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
      "\n  Accuracy Validation: Small Batch Size Performance Gains (exp-08)\n" +
      "=" + "=".repeat(79)
  );

  const batchSizes = [10, 50, 100];

  for (const batchSize of batchSizes) {
    console.log(`\n📊 Testing with ${batchSize} random points in France...\n`);
    const points = generateRandomPoints(batchSize);

    try {
      process.stdout.write("  → Fetching results from batch-no-bbox... ");
      const noBbox = await testVariant("/exp/07/batch-no-bbox", points);
      console.log(`✓ Got ${noBbox.results.length} results`);

      process.stdout.write("  → Fetching results from batch-with-bbox... ");
      const withBbox = await testVariant("/exp/07/batch-with-bbox", points);
      console.log(`✓ Got ${withBbox.results.length} results`);

      process.stdout.write("  → Fetching results from batch-with-bbox-indexed... ");
      const indexed = await testVariant("/exp/07/batch-with-bbox-indexed", points);
      console.log(`✓ Got ${indexed.results.length} results`);

      console.log("\nComparing results...\n");

      const noBboxVsWithBbox = areResultsEqual(noBbox.results, withBbox.results);
      const noBboxVsIndexed = areResultsEqual(noBbox.results, indexed.results);
      const withBboxVsIndexed = areResultsEqual(withBbox.results, indexed.results);

      console.log(
        `  batch-no-bbox vs batch-with-bbox:         ${
          noBboxVsWithBbox ? "✅ MATCH" : "❌ MISMATCH"
        }`
      );
      console.log(
        `  batch-no-bbox vs batch-with-bbox-indexed: ${
          noBboxVsIndexed ? "✅ MATCH" : "❌ MISMATCH"
        }`
      );
      console.log(
        `  batch-with-bbox vs batch-with-bbox-indexed: ${
          withBboxVsIndexed ? "✅ MATCH" : "❌ MISMATCH"
        }`
      );

      if (!noBboxVsWithBbox || !noBboxVsIndexed || !withBboxVsIndexed) {
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
  console.log("Conclusion: Bbox filters do NOT introduce false positives or false negatives.\n");
}

main().catch(console.error);
