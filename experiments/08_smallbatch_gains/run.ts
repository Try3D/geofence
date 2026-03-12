const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const BATCH_SIZES = [10, 50, 100];
const VARIANTS = ["no-bbox", "with-bbox", "with-bbox-indexed"];
const REQUESTS_PER_VARIANT = 10; // Just run 10 requests per variant

interface BenchmarkResult {
  batchSize: number;
  variant: string;
  throughput: number;
  avgLatency: number;
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
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json() as any;
  return (data.results || data).length;
}

async function benchmarkVariant(
  variant: string,
  batchSize: number,
  points: Array<{ lon: number; lat: number }>
): Promise<{ throughput: number; avgLatency: number; totalRequests: number }> {
  const endpoint = `/exp/07/batch-${variant}`;
  const latencies: number[] = [];

  for (let i = 0; i < REQUESTS_PER_VARIANT; i++) {
    const reqStart = Date.now();
    try {
      await fetchResults(endpoint, points);
      const reqEnd = Date.now();
      latencies.push(reqEnd - reqStart);
    } catch (err) {
      console.error(`  Error in ${variant}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const totalTime = latencies.reduce((a, b) => a + b, 0);
  const throughput = (REQUESTS_PER_VARIANT * 1000) / totalTime;
  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b) / latencies.length : 0;

  return { throughput, avgLatency, totalRequests: REQUESTS_PER_VARIANT };
}

async function main() {
  console.log(
    "=".repeat(80) +
      "\n  Small Batch Size Performance Gains (exp-08)\n" +
      "=".repeat(80)
  );

  const results: BenchmarkResult[] = [];

  for (const batchSize of BATCH_SIZES) {
    console.log(`\n📊 Testing batch size: ${batchSize} points\n`);
    const points = generateRandomPoints(batchSize);

    for (const variant of VARIANTS) {
      process.stdout.write(`  → ${variant.padEnd(20)} `);
      const { throughput, avgLatency, totalRequests } = await benchmarkVariant(variant, batchSize, points);
      console.log(`${throughput.toFixed(3)} req/s (${avgLatency.toFixed(0)}ms avg, n=${totalRequests})`);

      results.push({
        batchSize,
        variant,
        throughput: parseFloat(throughput.toFixed(4)),
        avgLatency: parseFloat(avgLatency.toFixed(2)),
        totalRequests,
      });
    }
  }

  // Write results
  const { writeFileSync, mkdirSync, existsSync } = await import("fs");
  const { join, resolve } = await import("path");

  const resultsDir = resolve(__dirname, "../../benchmark-results/08_smallbatch_gains");

  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const summary = {
    timestamp: new Date().toISOString(),
    name: "Small Batch Size Performance Gains",
    description: "Testing bbox filter optimization across different batch sizes",
    requestsPerVariant: REQUESTS_PER_VARIANT,
    results,
  };

  writeFileSync(
    join(resultsDir, "result.json"),
    JSON.stringify(summary, null, 2)
  );

  console.log("\n" + "=".repeat(80));
  console.log("✅ Results saved to benchmark-results/08_smallbatch_gains/result.json");
  console.log("=".repeat(80));

  // Print summary table
  console.log("\nPerformance Summary (Throughput in req/s):");
  console.log("--------+-----------+--------------+-------------------");
  console.log("Batch   | no-bbox   | with-bbox    | with-bbox-indexed");
  console.log("--------+-----------+--------------+-------------------");

  for (const batchSize of BATCH_SIZES) {
    const variants = results.filter((r) => r.batchSize === batchSize);
    const nobox = variants.find((r) => r.variant === "no-bbox");
    const withbox = variants.find((r) => r.variant === "with-bbox");
    const indexed = variants.find((r) => r.variant === "with-bbox-indexed");

    const nboxThroughput = nobox?.throughput.toFixed(3) || "N/A";
    const wboxThroughput = withbox?.throughput.toFixed(3) || "N/A";
    const idxThroughput = indexed?.throughput.toFixed(3) || "N/A";

    console.log(
      `${batchSize.toString().padEnd(7)} | ${nboxThroughput.padEnd(9)} | ${wboxThroughput.padEnd(12)} | ${idxThroughput}`
    );
  }

  // Print improvement percentages
  console.log("\n\nImprovement over baseline (%):");
  console.log("--------+-----------+-------------------");
  console.log("Batch   | with-bbox | with-bbox-indexed");
  console.log("--------+-----------+-------------------");

  for (const batchSize of BATCH_SIZES) {
    const variants = results.filter((r) => r.batchSize === batchSize);
    const nobox = variants.find((r) => r.variant === "no-bbox");
    const withbox = variants.find((r) => r.variant === "with-bbox");
    const indexed = variants.find((r) => r.variant === "with-bbox-indexed");

    if (nobox && withbox && indexed) {
      const wboxImp = ((withbox.throughput / nobox.throughput - 1) * 100).toFixed(1);
      const idxImp = ((indexed.throughput / nobox.throughput - 1) * 100).toFixed(1);
      console.log(`${batchSize.toString().padEnd(7)} | ${wboxImp.padStart(9)}% | ${idxImp.padStart(17)}%`);
    }
  }

  console.log("\n");
}

main().catch(console.error);
