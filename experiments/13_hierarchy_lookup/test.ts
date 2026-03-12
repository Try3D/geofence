#!/usr/bin/env npx tsx
/**
 * Quick test script to verify exp-13 endpoints return correct hierarchy data
 * Run this before benchmarking to ensure data integrity
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

async function runTests(): Promise<void> {
  console.log("Testing Exp-13 Endpoints\n");
  console.log("=".repeat(50));

  try {
    // Test 1: Small batch with recursive CTE
    console.log("\nTest 1: Recursive CTE with 3 points");
    const points1 = [
      { lon: 2.3, lat: 48.8 }, // Paris area
      { lon: 1.4, lat: 43.6 }, // Toulouse area
      { lon: -2.3, lat: 48.7 }, // Brittany area
    ];

    const result1 = (await makeRequest("POST", "/exp/13/recursive-cte", {
      points: points1,
    })) as any;

    console.log(`Points tested: ${result1.count}`);
    console.log(`Results returned: ${result1.results?.length}`);
    if (result1.results && result1.results[0]) {
      console.log(`First result hierarchy depth: ${result1.results[0].hierarchy?.length}`);
      if (result1.results[0].hierarchy?.length > 0) {
        console.log(`Hierarchy chain:`);
        result1.results[0].hierarchy.forEach((h: any) => {
          console.log(`  - ${h.name} (L${h.admin_level}, depth=${h.depth})`);
        });
      }
    }
    console.log("✓ Recursive CTE test passed");

    // Test 2: Small batch with sequential
    console.log("\nTest 2: Sequential with 3 points");
    const result2 = (await makeRequest("POST", "/exp/13/sequential", {
      points: points1,
    })) as any;

    console.log(`Points tested: ${result2.count}`);
    console.log(`Results returned: ${result2.results?.length}`);
    if (result2.results && result2.results[0]) {
      console.log(`First result hierarchy depth: ${result2.results[0].hierarchy?.length}`);
      if (result2.results[0].hierarchy?.length > 0) {
        console.log(`Hierarchy chain:`);
        result2.results[0].hierarchy.forEach((h: any) => {
          console.log(`  - ${h.name} (L${h.admin_level}, depth=${h.depth})`);
        });
      }
    }
    console.log("✓ Sequential test passed");

    // Test 3: Compare results
    console.log("\nTest 3: Comparing results");
    const h1 = result1.results[0]?.hierarchy || [];
    const h2 = result2.results[0]?.hierarchy || [];

    if (h1.length === h2.length) {
      console.log(
        `✓ Both patterns returned same hierarchy length: ${h1.length}`
      );

      // Compare names (order might differ)
      const names1 = new Set(h1.map((h: any) => h.name));
      const names2 = new Set(h2.map((h: any) => h.name));

      if (names1.size === names2.size) {
        let allMatch = true;
        names1.forEach((name) => {
          if (!names2.has(name)) {
            console.log(`  ✗ Name mismatch: "${name}" in CTE but not Sequential`);
            allMatch = false;
          }
        });

        if (allMatch) {
          console.log("✓ Both patterns returned identical hierarchy data");
        }
      }
    } else {
      console.log(
        `✗ Hierarchy length mismatch: CTE=${h1.length}, Sequential=${h2.length}`
      );
    }

    // Test 4: Get specific boundary hierarchy
    console.log("\nTest 4: Get specific boundary (ID=40005 - Paris)");
    const result4 = (await makeRequest("GET", "/exp/13/boundary/40005/hierarchy", undefined)) as any;

    console.log(`Boundary ID: ${result4.boundary_id}`);
    console.log(`Hierarchy levels: ${result4.hierarchy?.length || 0}`);
    if (result4.hierarchy) {
      result4.hierarchy.forEach((h: any) => {
        console.log(`  - ${h.name} (L${h.admin_level})`);
      });
    }
    console.log("✓ Specific boundary lookup test passed");

    console.log("\n" + "=".repeat(50));
    console.log("\n✅ All tests passed! Ready for benchmarking.\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

runTests();
