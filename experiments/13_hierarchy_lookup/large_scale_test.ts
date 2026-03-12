#!/usr/bin/env npx tsx
/**
 * Large-scale validation test for exp-13 hierarchy endpoints
 * Tests with 1000s of random points to ensure correctness at scale
 */

import http from "http";
import https from "https";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

function makeRequest(
  method: string,
  path: string,
  body?: object
): Promise<object | string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const payload = body ? JSON.stringify(body) : undefined;

    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload && { "Content-Length": payload.length }),
      },
    };

    const protocol = url.protocol === "https:" ? https : http;
    const req = protocol.request(url.toString(), options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Generate random points in France
function generateRandomPoints(count: number): Array<{ lon: number; lat: number }> {
  const points: Array<{ lon: number; lat: number }> = [];
  for (let i = 0; i < count; i++) {
    // France approximate bounds: lon [-8, 8], lat [41, 51]
    const lon = -8 + Math.random() * 16;
    const lat = 41 + Math.random() * 10;
    points.push({ lon, lat });
  }
  return points;
}

async function validateLargeScale(): Promise<void> {
  console.log("Large-Scale Validation Test for Exp-13\n");
  console.log("=".repeat(60));

  try {
    // Test 1: 100 random points
    console.log("\n[Test 1] 100 random points");
    const points100 = generateRandomPoints(100);
    const result100 = (await makeRequest("POST", "/exp/13/recursive-cte", {
      points: points100,
    })) as any;

    console.log(`  Points sent: ${result100.count}`);
    console.log(`  Results returned: ${result100.results?.length}`);
    
    const validResults100 = result100.results?.filter((r: any) => r.hierarchy && r.hierarchy.length > 0).length || 0;
    console.log(`  Valid hierarchies: ${validResults100}/${result100.results?.length}`);
    console.log(`  Match rate: ${((validResults100 / (result100.results?.length || 1)) * 100).toFixed(1)}%`);

    if (validResults100 > 0) {
      const firstValid = result100.results.find((r: any) => r.hierarchy && r.hierarchy.length > 0);
      console.log(`  Sample hierarchy depth: ${firstValid.hierarchy.length}`);
    }

    // Test 2: 500 random points
    console.log("\n[Test 2] 500 random points");
    const points500 = generateRandomPoints(500);
    const result500 = (await makeRequest("POST", "/exp/13/recursive-cte", {
      points: points500,
    })) as any;

    console.log(`  Points sent: ${result500.count}`);
    console.log(`  Results returned: ${result500.results?.length}`);
    
    const validResults500 = result500.results?.filter((r: any) => r.hierarchy && r.hierarchy.length > 0).length || 0;
    console.log(`  Valid hierarchies: ${validResults500}/${result500.results?.length}`);
    console.log(`  Match rate: ${((validResults500 / (result500.results?.length || 1)) * 100).toFixed(1)}%`);

    // Test 3: 1000 random points
    console.log("\n[Test 3] 1000 random points");
    const points1000 = generateRandomPoints(1000);
    const result1000 = (await makeRequest("POST", "/exp/13/recursive-cte", {
      points: points1000,
    })) as any;

    console.log(`  Points sent: ${result1000.count}`);
    console.log(`  Results returned: ${result1000.results?.length}`);
    
    const validResults1000 = result1000.results?.filter((r: any) => r.hierarchy && r.hierarchy.length > 0).length || 0;
    console.log(`  Valid hierarchies: ${validResults1000}/${result1000.results?.length}`);
    console.log(`  Match rate: ${((validResults1000 / (result1000.results?.length || 1)) * 100).toFixed(1)}%`);

    // Analyze hierarchy depth distribution
    console.log("\n  Hierarchy depth distribution (from valid results only):");
    const depthCounts: Record<number, number> = {};
    const emptyCount = result1000.results?.filter((r: any) => !r.hierarchy || r.hierarchy.length === 0).length || 0;
    
    result1000.results?.forEach((r: any) => {
      if (r.hierarchy && r.hierarchy.length > 0) {
        const depth = r.hierarchy.length;
        depthCounts[depth] = (depthCounts[depth] || 0) + 1;
      }
    });
    
    console.log(`    Empty hierarchies: ${emptyCount} (${((emptyCount / (result1000.results?.length || 1)) * 100).toFixed(1)}%)`);
    Object.keys(depthCounts)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((depth) => {
        const count = depthCounts[depth];
        const pct = ((count / validResults1000) * 100).toFixed(1);
        console.log(`    Depth ${depth}: ${count} results (${pct}%)`);
      });

    // Test 4: Compare recursive-cte vs sequential on 500 points
    console.log("\n[Test 4] Compare patterns on 500 points");
    const points500Compare = generateRandomPoints(500);
    
    const resultCTE = (await makeRequest("POST", "/exp/13/recursive-cte", {
      points: points500Compare,
    })) as any;
    
    const resultSeq = (await makeRequest("POST", "/exp/13/sequential", {
      points: points500Compare,
    })) as any;

    let matches = 0;
    let mismatches = 0;

    for (let i = 0; i < Math.min(resultCTE.results?.length || 0, resultSeq.results?.length || 0); i++) {
      const cteHierarchy = resultCTE.results[i].hierarchy || [];
      const seqHierarchy = resultSeq.results[i].hierarchy || [];

      // Convert to ID arrays for comparison (handle both number and string IDs)
      const cteIds = cteHierarchy.map((h: any) => parseInt(String(h.id))).sort((a: number, b: number) => a - b);
      const seqIds = seqHierarchy.map((h: any) => parseInt(String(h.id))).sort((a: number, b: number) => a - b);

      // Compare sorted ID arrays
      const match = JSON.stringify(cteIds) === JSON.stringify(seqIds);
      
      if (match) {
        matches++;
      } else {
        mismatches++;
      }
    }

    console.log(`  Recursive CTE results: ${resultCTE.results?.length}`);
    console.log(`  Sequential results: ${resultSeq.results?.length}`);
    console.log(`  Matching hierarchies: ${matches}`);
    console.log(`  Mismatching hierarchies: ${mismatches}`);
    console.log(`  Pattern agreement: ${((matches / (matches + mismatches)) * 100).toFixed(1)}%`);

    // Final summary
    console.log("\n" + "=".repeat(60));
    if (validResults1000 / (result1000.results?.length || 1) > 0.95 && matches / (matches + mismatches) > 0.99) {
      console.log("✅ Large-scale validation PASSED");
      console.log(`   - 1000 points: ${((validResults1000 / (result1000.results?.length || 1)) * 100).toFixed(1)}% valid`);
      console.log(`   - Pattern agreement: ${((matches / (matches + mismatches)) * 100).toFixed(1)}%`);
    } else {
      console.log("⚠️  Large-scale validation completed with warnings");
      if (validResults1000 / (result1000.results?.length || 1) < 0.95) {
        console.log(`   - Only ${((validResults1000 / (result1000.results?.length || 1)) * 100).toFixed(1)}% of results valid`);
      }
      if (matches / (matches + mismatches) < 0.99) {
        console.log(`   - Pattern agreement only ${((matches / (matches + mismatches)) * 100).toFixed(1)}%`);
      }
    }
    console.log();
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

validateLargeScale();
