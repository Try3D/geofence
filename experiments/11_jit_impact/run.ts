const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const BATCH_SIZES = [10, 50, 100];
const REQUESTS_PER_SIZE = 30;

interface BenchmarkResult {
  batchSize: number;
  jitState: string;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  throughput: number;
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

async function getJitStatus(): Promise<string> {
  try {
    const response = await fetch(`${BASE_URL}/exp/11/status`);
    const data = await response.json();
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function runBenchmark(): Promise<void> {
  console.log("JIT Impact Benchmark (Enhanced)");
  console.log("=".repeat(70));
  console.log(
    "\nIMPORTANT: This benchmark requires manual JIT toggling in PostgreSQL:\n"
  );
  console.log("PHASE 1: Benchmark with JIT ON (default)");
  console.log("  1. Ensure JIT is enabled: psql -c \"ALTER SYSTEM SET jit = on; SELECT pg_reload_conf();\"");
  console.log("  2. Run: npx tsx experiments/11_jit_impact/run.ts");
  console.log(
    "\nPHASE 2: Benchmark with JIT OFF"
  );
  console.log("  1. Disable JIT: psql -c \"ALTER SYSTEM SET jit = off; SELECT pg_reload_conf();\"");
  console.log("  2. Run: npx tsx experiments/11_jit_impact/run.ts");
  console.log(
    "\nPHASE 3: Restore"
  );
  console.log("  1. Re-enable JIT: psql -c \"ALTER SYSTEM SET jit = on; SELECT pg_reload_conf();\"");
  console.log("\n" + "=".repeat(70) + "\n");

  const currentJitState = await getJitStatus();
  console.log(`Current JIT state: ${currentJitState}\n`);

  console.log(`Config: ${REQUESTS_PER_SIZE} requests per batch size\n`);

  const results: BenchmarkResult[] = [];
  const endpoint = "/exp/11/lookup";

  for (const batchSize of BATCH_SIZES) {
    console.log(`\nBatch Size: ${batchSize} points`);
    console.log("=".repeat(70));

    const latencies: number[] = [];

    try {
      for (let i = 0; i < REQUESTS_PER_SIZE; i++) {
        const points = generateRandomPoints(batchSize);
        const latency = await fetchResults(endpoint, points);
        latencies.push(latency);

        if ((i + 1) % 10 === 0) {
          process.stdout.write(
            `  Progress: ${i + 1}/${REQUESTS_PER_SIZE} requests\r`
          );
        }
      }

      const avgLatency =
        latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const minLatency = Math.min(...latencies);
      const maxLatency = Math.max(...latencies);
      const totalMs = latencies.reduce((a, b) => a + b, 0);
      const throughput = (REQUESTS_PER_SIZE / (totalMs / 1000)).toFixed(2);

      results.push({
        batchSize,
        jitState: "check_manually",
        avgLatency: parseFloat(avgLatency.toFixed(2)),
        minLatency: parseFloat(minLatency.toFixed(2)),
        maxLatency: parseFloat(maxLatency.toFixed(2)),
        throughput: parseFloat(throughput),
        totalRequests: REQUESTS_PER_SIZE,
      });

      console.log(
        `\nCompleted: Avg: ${avgLatency.toFixed(2)}ms | Min: ${minLatency.toFixed(2)}ms | Max: ${maxLatency.toFixed(2)}ms | Throughput: ${throughput} req/s`
      );
    } catch (error) {
      console.error(`\nError during benchmark:`, error);
    }
  }

  // Print summary table
  console.log("\n\nSummary Table");
  console.log("=".repeat(100));
  console.log(
    "Batch Size | Avg Latency | Min Latency | Max Latency | Throughput | Requests"
  );
  console.log("-".repeat(100));

  for (const result of results) {
    console.log(
      `${result.batchSize.toString().padEnd(10)} | ${result.avgLatency.toString().padEnd(11)}ms | ${result.minLatency.toString().padEnd(11)}ms | ${result.maxLatency.toString().padEnd(11)}ms | ${result.throughput.toString().padEnd(10)} req/s | ${result.totalRequests}`
    );
  }

  // Save results to file
  const fs = await import("fs");
  const resultsDir = "/Users/rsaran/Projects/geofence/benchmark-results/11_jit_impact";
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  // Append to results with timestamp
  const timestamp = new Date().toISOString();
  const resultsWithMeta = {
    timestamp,
    jitStateNote: "Check PostgreSQL config manually - update this after running",
    results,
  };
  
  fs.writeFileSync(
    `${resultsDir}/results.json`,
    JSON.stringify(resultsWithMeta, null, 2)
  );
  console.log(`\nResults saved to ${resultsDir}/results.json`);
}

runBenchmark().catch(console.error);
