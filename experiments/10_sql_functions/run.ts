const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const BATCH_SIZES = [10, 50, 100];
const VARIANTS = ["baseline", "prepared", "function"];
const REQUESTS_PER_VARIANT = 10;

interface BenchmarkResult {
  batchSize: number;
  variant: string;
  throughput: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  totalRequests: number;
}

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

async function fetchResults(
  endpoint: string,
  points: Array<{ lon: number; lat: number }>
): Promise<number> {
  const startTime = performance.now();
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
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}`
    );
  }

  await response.json();
  const endTime = performance.now();
  return endTime - startTime;
}

async function runBenchmark(): Promise<void> {
  console.log("Starting SQL Function & Prepared Statement Benchmark...\n");
  console.log(`Config: ${REQUESTS_PER_VARIANT} requests per variant\n`);

  const results: BenchmarkResult[] = [];

  for (const batchSize of BATCH_SIZES) {
    console.log(`\nBatch Size: ${batchSize} points`);
    console.log("=".repeat(50));

    for (const variant of VARIANTS) {
      const endpoint = `/exp/10/${variant}`;
      const latencies: number[] = [];

      try {
        for (let i = 0; i < REQUESTS_PER_VARIANT; i++) {
          const points = generateRandomPoints(batchSize);
          const latency = await fetchResults(endpoint, points);
          latencies.push(latency);

          if ((i + 1) % 10 === 0) {
            process.stdout.write(
              `  ${variant}: ${i + 1}/${REQUESTS_PER_VARIANT} requests\r`
            );
          }
        }

        const avgLatency =
          latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const minLatency = Math.min(...latencies);
        const maxLatency = Math.max(...latencies);
        const throughput = (REQUESTS_PER_VARIANT / (latencies.reduce((a, b) => a + b, 0) / 1000)).toFixed(2);

        results.push({
          batchSize,
          variant,
          throughput: parseFloat(throughput),
          avgLatency: parseFloat(avgLatency.toFixed(2)),
          minLatency: parseFloat(minLatency.toFixed(2)),
          maxLatency: parseFloat(maxLatency.toFixed(2)),
          totalRequests: REQUESTS_PER_VARIANT,
        });

        console.log(
          `\n${variant.padEnd(12)} | Avg: ${avgLatency.toFixed(2)}ms | Min: ${minLatency.toFixed(2)}ms | Max: ${maxLatency.toFixed(2)}ms | Throughput: ${throughput} req/s`
        );
      } catch (error) {
        console.error(`\nError testing ${variant}:`, error);
      }
    }
  }

  // Print summary table
  console.log("\n\nSummary Table");
  console.log("=".repeat(100));
  console.log(
    "Batch Size | Variant     | Avg Latency | Min Latency | Max Latency | Throughput | Requests"
  );
  console.log("-".repeat(100));

  for (const result of results) {
    console.log(
      `${result.batchSize.toString().padEnd(10)} | ${result.variant.padEnd(11)} | ${result.avgLatency.toString().padEnd(11)}ms | ${result.minLatency.toString().padEnd(11)}ms | ${result.maxLatency.toString().padEnd(11)}ms | ${result.throughput.toString().padEnd(10)} req/s | ${result.totalRequests}`
    );
  }

  // Save results to file
  const fs = await import("fs");
  const resultsDir = "/Users/rsaran/Projects/geofence/benchmark-results/10_sql_functions";
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  fs.writeFileSync(
    `${resultsDir}/results.json`,
    JSON.stringify(results, null, 2)
  );
  console.log(`\nResults saved to ${resultsDir}/results.json`);
}

runBenchmark().catch(console.error);
