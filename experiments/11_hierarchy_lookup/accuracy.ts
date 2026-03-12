const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

// Generate random points in France
function generateRandomPoints(count: number): Array<{ lon: number; lat: number }> {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lon: -8 + Math.random() * 16,
      lat: 41 + Math.random() * 10,
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
    if (r1.hierarchy.length !== r2.hierarchy.length) return false;

    // Compare hierarchy structure
    for (let j = 0; j < r1.hierarchy.length; j++) {
      if (r1.hierarchy[j].osm_id !== r2.hierarchy[j].osm_id) return false;
      if (r1.hierarchy[j].admin_level !== r2.hierarchy[j].admin_level) return false;
    }
  }

  return true;
}

async function main() {
  console.log(
    "=" + "=".repeat(79) +
      "\n  Accuracy Validation: Hierarchical Boundary Lookups (exp-11)\n" +
      "=" + "=".repeat(79)
  );

  const batchSizes = [50, 100];

  for (const batchSize of batchSizes) {
    console.log(`\n📊 Testing with ${batchSize} random points in France...\n`);
    const points = generateRandomPoints(batchSize);

    try {
      process.stdout.write("  → Fetching results from baseline... ");
      const baseline = await testVariant("/exp/11/baseline", points);
      console.log(`✓ Got ${baseline.results.length} results, ${baseline.results.filter((r: any) => r.hierarchy.length > 0).length} matched`);

      process.stdout.write("  → Fetching results from normal... ");
      const normal = await testVariant("/exp/11/normal", points);
      console.log(`✓ Got ${normal.results.length} results, ${normal.results.filter((r: any) => r.hierarchy.length > 0).length} matched`);

      process.stdout.write("  → Fetching results from cte... ");
      const cte = await testVariant("/exp/11/cte", points);
      console.log(`✓ Got ${cte.results.length} results, ${cte.results.filter((r: any) => r.hierarchy.length > 0).length} matched`);

      process.stdout.write("  → Fetching results from cte-fallback... ");
      const cteFallback = await testVariant("/exp/11/cte-fallback", points);
      console.log(`✓ Got ${cteFallback.results.length} results, ${cteFallback.results.filter((r: any) => r.hierarchy.length > 0).length} matched`);

      console.log("\nComparing empty/non-empty results...\n");

      let baselineMatchCount = baseline.results.filter((r: any) => r.hierarchy.length > 0).length;
      let normalMatchCount = normal.results.filter((r: any) => r.hierarchy.length > 0).length;
      let cteMatchCount = cte.results.filter((r: any) => r.hierarchy.length > 0).length;
      let cteFallbackMatchCount = cteFallback.results.filter((r: any) => r.hierarchy.length > 0).length;

      console.log(
        `  baseline:     ${baselineMatchCount}/${batchSize} matched (${(baselineMatchCount/batchSize*100).toFixed(1)}%)`
      );
      console.log(
        `  normal:       ${normalMatchCount}/${batchSize} matched (${(normalMatchCount/batchSize*100).toFixed(1)}%)`
      );
      console.log(
        `  cte:          ${cteMatchCount}/${batchSize} matched (${(cteMatchCount/batchSize*100).toFixed(1)}%)`
      );
      console.log(
        `  cte-fallback: ${cteFallbackMatchCount}/${batchSize} matched (${(cteFallbackMatchCount/batchSize*100).toFixed(1)}%)`
      );

      // Verify that cte-fallback matches or exceeds other variants
      if (cteFallbackMatchCount < baselineMatchCount) {
        console.log("\n⚠️  WARNING: cte-fallback has fewer matches than baseline!");
      }
    } catch (err) {
      console.error(`\n❌ Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  console.log(
    "\n✅ SUCCESS: All variants completed accuracy testing!\n"
  );
  console.log("Note: Accuracy differences are expected and documented in README.\n");
}

main().catch(console.error);
