const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const BATCH_SIZES = [10, 50, 100];
const VARIANTS = ["full", "ids-only", "ids-optimized"];
const REQUESTS_PER_VARIANT = 10;

interface BenchmarkResult {
  batchSize: number;
  variant: string;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  throughput: number;
  avgPayloadSize: number;
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
): Promise<{ latency: number; payloadSize: number }> {
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

  const jsonData = await response.json();
  const endTime = performance.now();

  // Calculate approximate payload size
  const payloadSize = JSON.stringify(jsonData).length;

  return {
    latency: endTime - startTime,
    payloadSize,
  };
}

async function runBenchmark(): Promise<void> {
  console.log("Minimal Payload Optimization Benchmark");
  console.log("=".repeat(60));
  console.log("\nComparing response formats:");
  console.log("  - full: { osm_id, name }");
  console.log("  - ids-only: [osm_id] (name fetched from full query)");
  console.log("  - ids-optimized: [osm_id] (query optimized to exclude name)\n");

  console.log(`Config: ${REQUESTS_PER_VARIANT} requests per variant\n`);

  const results: BenchmarkResult[] = [];

  for (const batchSize of BATCH_SIZES) {
    console.log(`\nBatch Size: ${batchSize} points`);
    console.log("=".repeat(60));

    for (const variant of VARIANTS) {
      const endpoint = `/exp/12/${variant}`;
      const latencies: number[] = [];
      const payloadSizes: number[] = [];

      try {
        for (let i = 0; i < REQUESTS_PER_VARIANT; i++) {
          const points = generateRandomPoints(batchSize);
          const { latency, payloadSize } = await fetchResults(endpoint, points);
          latencies.push(latency);
          payloadSizes.push(payloadSize);

          if ((i + 1) % 10 === 0) {
            process.stdout.write(
              `  ${variant.padEnd(15)}: ${i + 1}/${REQUESTS_PER_VARIANT} requests\r`
            );
          }
        }

        const avgLatency =
          latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const minLatency = Math.min(...latencies);
        const maxLatency = Math.max(...latencies);
        const avgPayloadSize =
          payloadSizes.reduce((a, b) => a + b, 0) / payloadSizes.length;
        const totalMs = latencies.reduce((a, b) => a + b, 0);
        const throughput = (REQUESTS_PER_VARIANT / (totalMs / 1000)).toFixed(2);

        results.push({
          batchSize,
          variant,
          avgLatency: parseFloat(avgLatency.toFixed(2)),
          minLatency: parseFloat(minLatency.toFixed(2)),
          maxLatency: parseFloat(maxLatency.toFixed(2)),
          throughput: parseFloat(throughput),
          avgPayloadSize: parseFloat(avgPayloadSize.toFixed(0)),
          totalRequests: REQUESTS_PER_VARIANT,
        });

        console.log(
          `\n${variant.padEnd(15)} | Avg: ${avgLatency.toFixed(2)}ms | Size: ${avgPayloadSize.toFixed(0)}B | Throughput: ${throughput} req/s`
        );
      } catch (error) {
        console.error(`\nError testing ${variant}:`, error);
      }
    }
  }

  // Print summary table
  console.log("\n\nSummary Table");
  console.log("=".repeat(120));
  console.log(
    "Batch | Variant        | Avg Latency | Min Latency | Max Latency | Payload Size | Throughput  | Requests"
  );
  console.log("-".repeat(120));

  for (const result of results) {
    console.log(
      `${result.batchSize.toString().padEnd(5)} | ${result.variant.padEnd(14)} | ${result.avgLatency.toString().padEnd(11)}ms | ${result.minLatency.toString().padEnd(11)}ms | ${result.maxLatency.toString().padEnd(11)}ms | ${result.avgPayloadSize.toString().padEnd(12)}B | ${result.throughput.toString().padEnd(11)} req/s | ${result.totalRequests}`
    );
  }

  // Calculate improvements
  console.log("\n\nPayload Size Comparison (relative to 'full')");
  console.log("=".repeat(80));

  for (const batchSize of BATCH_SIZES) {
    const fullResult = results.find(
      (r) => r.batchSize === batchSize && r.variant === "full"
    );
    if (!fullResult) continue;

    console.log(`\nBatch Size: ${batchSize} points (full payload: ${fullResult.avgPayloadSize}B)`);
    for (const variant of VARIANTS) {
      if (variant === "full") continue;
      const result = results.find(
        (r) => r.batchSize === batchSize && r.variant === variant
      );
      if (!result) continue;

      const sizeReduction =
        ((fullResult.avgPayloadSize - result.avgPayloadSize) /
          fullResult.avgPayloadSize) *
        100;
      const latencyImprovement =
        ((fullResult.avgLatency - result.avgLatency) / fullResult.avgLatency) *
        100;

      console.log(
        `  ${variant.padEnd(15)}: ${sizeReduction.toFixed(1)}% smaller | ${latencyImprovement.toFixed(1)}% faster`
      );
    }
  }

  // Save results to file
  const fs = await import("fs");
  const resultsDir = "/Users/rsaran/Projects/geofence/benchmark-results/12_minimal_payload";
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
