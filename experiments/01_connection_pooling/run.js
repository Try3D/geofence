#!/usr/bin/env node

import { exec, execSync, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "../..");

// Configuration
const EXPERIMENTS = [
  { apiPool: 10, pgPool: 20 },
  { apiPool: 15, pgPool: 25 },
  { apiPool: 20, pgPool: 25 },
  { apiPool: 25, pgPool: 25 },
  { apiPool: 30, pgPool: 25 },
  { apiPool: 35, pgPool: 25 },
  { apiPool: 40, pgPool: 25 },
];

const RESULTS_DIR = path.join(PROJECT_ROOT, "benchmark-results", "01_connection_pooling");
const OUTPUT_FILE = path.join(RESULTS_DIR, "profiler-results.json");
const SUMMARY_FILE = path.join(RESULTS_DIR, "summary.txt");

// Ensure results directory exists
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

console.log("🚀 Geofence Profiler - Pool Size Optimization");
console.log("=".repeat(60));

async function updateApiPoolSize(size) {
  const dbPath = path.join(PROJECT_ROOT, "backend/src/db.ts");
  const content = fs.readFileSync(dbPath, { encoding: "utf-8" });
  const updated = content.replace(/max:\s*\d+/g, `max: ${size}`);
  fs.writeFileSync(dbPath, updated, { encoding: "utf-8" });
  console.log(`✓ Updated API pool size to ${size}`);
}

async function updatePgBouncerPoolSize(size) {
  const configPath = path.join(PROJECT_ROOT, "pgbouncer.ini");
  const content = fs.readFileSync(configPath, { encoding: "utf-8" });
  const updated = content.replace(/default_pool_size\s*=\s*\d+/, `default_pool_size = ${size}`);
  fs.writeFileSync(configPath, updated, { encoding: "utf-8" });
  console.log(`✓ Updated PgBouncer pool size to ${size}`);
}

async function killProcessByPort(port) {
  try {
    if (process.platform === "darwin") {
      // macOS
      execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: "ignore" });
    } else {
      // Linux
      execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
    }
    console.log(`✓ Killed process on port ${port}`);
  } catch (e) {
    // Process might not exist, that's okay
  }
}

async function waitForService(port, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const { stdout } = await execAsync(`curl -s http://localhost:${port}/health`);
      const response = JSON.parse(stdout);
      if (response.ok) {
        console.log(`✓ Service on port ${port} is ready`);
        return true;
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Service on port ${port} failed to start within ${timeout}ms`);
}

async function runK6Test(testName) {
  console.log(`\n⚙️  Running k6 benchmark: ${testName}`);

  const resultFile = path.join(RESULTS_DIR, `${testName}.json`);
  const summaryFile = path.join(RESULTS_DIR, `${testName}-summary.json`);

  return new Promise((resolve, reject) => {
    const proc = spawn("k6", [
      "run",
      path.join(PROJECT_ROOT, "k6/k6-benchmark.js"),
      `--out`, `json=${resultFile}`,
      `--summary-export=${summaryFile}`,
    ], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      // code 99 = thresholds exceeded but test ran fine — still capture results
      if (code === 0 || code === 99) {
        const status = code === 99 ? " (thresholds exceeded)" : "";
        console.log(`✓ k6 test completed${status}`);
        resolve(summaryFile);
      } else {
        reject(new Error(`k6 test failed with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

function parseK6Results(summaryFile) {
  const content = fs.readFileSync(summaryFile, { encoding: "utf-8" });
  const summary = JSON.parse(content);
  const m = summary.metrics;

  return {
    throughput:    m.http_reqs?.rate                || 0,
    avgLatency:    m.http_req_duration?.avg        || 0,
    p50Latency:    m.http_req_duration?.med        || 0,
    p95Latency:    m.http_req_duration?.["p(95)"]  || 0,
    p99Latency:    m.http_req_duration?.["p(99)"] || m.http_req_duration?.max || 0,
    failureRate:   m.http_req_failed?.value        || 0,
    totalRequests: m.http_reqs?.count              || 0,
  };
}

async function runExperiment(apiPool, pgPool, index, total) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 Experiment ${index}/${total}: API Pool=${apiPool}, PgBouncer Pool=${pgPool}`);
  console.log(`${"=".repeat(60)}`);

  try {
    // Update configs
    await updateApiPoolSize(apiPool);
    await updatePgBouncerPoolSize(pgPool);

    // Restart services
    console.log("\n🔄 Restarting services...");

    // Kill backend
    await killProcessByPort(3000);
    await new Promise((r) => setTimeout(r, 1000));

    // Restart pgbouncer via docker-compose
    console.log("  Restarting PgBouncer...");
    await execAsync("docker-compose restart pgbouncer", { cwd: PROJECT_ROOT });
    await new Promise((r) => setTimeout(r, 2000));

    // Start backend
    console.log("  Starting backend...");
    spawn("npm", ["run", "dev"], {
      cwd: path.join(PROJECT_ROOT, "backend"),
      detached: true,
      stdio: "ignore",
    }).unref();

    // Wait for services to be ready
    await waitForService(3000);

    // Run test
    const testName = `test-api${apiPool}-pg${pgPool}`;
    const resultFile = await runK6Test(testName);

    // Parse results
    const metrics = parseK6Results(resultFile);

    return {
      apiPool,
      pgPool,
      ...metrics,
    };
  } catch (error) {
    console.error(`✗ Experiment failed: ${error.message}`);
    return {
      apiPool,
      pgPool,
      error: error.message,
    };
  }
}

function formatResults(results) {
  const headers = [
    "API Pool",
    "PG Pool",
    "Throughput",
    "Avg Latency",
    "P95 Latency",
    "P99 Latency",
    "Total Reqs",
    "Failures",
  ];

  const rows = results.map((r) => [
    r.apiPool.toString(),
    r.pgPool.toString(),
    r.throughput ? r.throughput.toFixed(2) : "ERROR",
    r.avgLatency ? `${r.avgLatency.toFixed(0)}ms` : "ERROR",
    r.p95Latency ? `${r.p95Latency.toFixed(0)}ms` : "ERROR",
    r.p99Latency ? `${r.p99Latency.toFixed(0)}ms` : "ERROR",
    r.totalRequests ? r.totalRequests.toString() : "ERROR",
    r.failureRate != null && !r.error ? `${(r.failureRate * 100).toFixed(1)}%` : "ERROR",
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  // Print header
  let output = "";
  output += headers.map((h, i) => h.padEnd(widths[i])).join(" │ ") + "\n";
  output += widths.map((w) => "─".repeat(w)).join("─┼─") + "\n";

  // Print rows
  rows.forEach((row) => {
    output += row.map((cell, i) => cell.padEnd(widths[i])).join(" │ ") + "\n";
  });

  return output;
}

async function main() {
  const results = [];

  try {
    for (let i = 0; i < EXPERIMENTS.length; i++) {
      const { apiPool, pgPool } = EXPERIMENTS[i];
      const result = await runExperiment(apiPool, pgPool, i + 1, EXPERIMENTS.length);
      results.push(result);
    }

    // Save results to JSON
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n✓ Results saved to ${OUTPUT_FILE}`);

    // Generate summary
    const summary =
      "Profiler Results Summary\n" +
      "=".repeat(60) +
      "\n\n" +
      formatResults(results) +
      "\n" +
      "=".repeat(60) +
      "\nFull results: " +
      OUTPUT_FILE;

    fs.writeFileSync(SUMMARY_FILE, summary);
    console.log(`✓ Summary saved to ${SUMMARY_FILE}`);

    // Print summary
    console.log("\n" + summary);

    // Analysis
    console.log("\n📈 Analysis:");
    const successful = results.filter((r) => !r.error);
    if (successful.length > 0) {
      const maxThroughput = Math.max(...successful.map((r) => r.throughput));
      const bestResult = successful.find((r) => r.throughput === maxThroughput);
      console.log(
        `  Best throughput: ${maxThroughput.toFixed(2)} req/s at API Pool=${bestResult.apiPool}, PG Pool=${bestResult.pgPool}`
      );

      const minLatency = Math.min(...successful.map((r) => r.p95Latency));
      const latencyResult = successful.find((r) => r.p95Latency === minLatency);
      console.log(
        `  Best P95 latency: ${minLatency.toFixed(0)}ms at API Pool=${latencyResult.apiPool}, PG Pool=${latencyResult.pgPool}`
      );
    }
  } catch (error) {
    console.error(`\n✗ Fatal error: ${error.message}`);
    process.exit(1);
  }
}

main();
