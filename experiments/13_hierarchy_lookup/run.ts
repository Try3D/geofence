import http from "http";
import https from "https";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const BATCH_SIZES = [10, 25, 50];
const VARIANTS = ["recursive-cte", "sequential"];
const REQUESTS_PER_VARIANT = 10;

interface BenchmarkResult {
  batchSize: number;
  variant: string;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  throughput: number;
  totalRequests: number;
  avgPayloadSize: number;
  jitState: string;
}

// Generate random points in France (approximate bounds)
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

async function makeRequest(
  variant: string,
  points: Array<{ lon: number; lat: number }>
): Promise<{ latency: number; payloadSize: number }> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const payload = JSON.stringify({ points });

    const url = new URL(`${BASE_URL}/exp/13/${variant}`);
    const reqOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": payload.length,
      },
    };

    const protocol = url.protocol === "https:" ? https : http;
    const req = protocol.request(
      url.toString(),
      reqOptions,
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const latency = Date.now() - startTime;
          const payloadSize = data.length;
          resolve({ latency, payloadSize });
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function benchmarkVariant(
  variant: string,
  batchSize: number
): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  const payloadSizes: number[] = [];

  const points = generateRandomPoints(batchSize);

  for (let i = 0; i < REQUESTS_PER_VARIANT; i++) {
    try {
      const { latency, payloadSize } = await makeRequest(variant, points);
      latencies.push(latency);
      payloadSizes.push(payloadSize);
      console.log(
        `  [${variant}] Batch ${batchSize}: Request ${i + 1}/${REQUESTS_PER_VARIANT} - ${latency}ms`
      );
    } catch (error) {
      console.error(
        `  [${variant}] Batch ${batchSize}: Request ${i + 1} failed:`,
        error
      );
      throw error;
    }
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const throughput = (REQUESTS_PER_VARIANT / (avgLatency / 1000)) * batchSize; // requests/points per second
  const avgPayloadSize =
    payloadSizes.reduce((a, b) => a + b, 0) / payloadSizes.length;

  return {
    batchSize,
    variant,
    avgLatency: Math.round(avgLatency * 100) / 100,
    minLatency,
    maxLatency,
    throughput: Math.round(throughput * 100) / 100,
    totalRequests: REQUESTS_PER_VARIANT,
    avgPayloadSize: Math.round(avgPayloadSize),
    jitState: "warm", // After first iteration
  };
}

async function runBenchmark(): Promise<void> {
  const results: BenchmarkResult[] = [];

  console.log("Starting Exp-13: Hierarchy Lookup Benchmark");
  console.log(`Testing variants: ${VARIANTS.join(", ")}`);
  console.log(`Batch sizes: ${BATCH_SIZES.join(", ")}`);
  console.log(`Requests per variant: ${REQUESTS_PER_VARIANT}\n`);

  for (const batchSize of BATCH_SIZES) {
    console.log(`\n=== Batch Size: ${batchSize} ===`);
    for (const variant of VARIANTS) {
      console.log(`\nBenchmarking ${variant}...`);
      try {
        const result = await benchmarkVariant(variant, batchSize);
        results.push(result);
        console.log(`  Average Latency: ${result.avgLatency}ms`);
        console.log(`  Min/Max Latency: ${result.minLatency}/${result.maxLatency}ms`);
        console.log(`  Throughput: ${result.throughput} points/sec`);
        console.log(`  Avg Payload Size: ${result.avgPayloadSize} bytes`);
      } catch (error) {
        console.error(`Failed to benchmark ${variant}:`, error);
        process.exit(1);
      }
    }
  }

  // Print summary table
  console.log("\n\n=== SUMMARY ===\n");
  console.table(results);

  // Analysis
  console.log("\n=== ANALYSIS ===\n");

  for (const batchSize of BATCH_SIZES) {
    const batchResults = results.filter((r) => r.batchSize === batchSize);
    const recursive = batchResults.find((r) => r.variant === "recursive-cte");
    const sequential = batchResults.find((r) => r.variant === "sequential");

    if (recursive && sequential) {
      const improvementPercent =
        ((sequential.avgLatency - recursive.avgLatency) / recursive.avgLatency) *
        100;
      const improvementDirection =
        improvementPercent < 0
          ? `${Math.abs(improvementPercent).toFixed(1)}% faster`
          : `${improvementPercent.toFixed(1)}% slower`;

      console.log(
        `Batch ${batchSize}: Sequential is ${improvementDirection} than Recursive CTE`
      );
    }
  }

  console.log("\nBenchmark complete!");
}

runBenchmark().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
