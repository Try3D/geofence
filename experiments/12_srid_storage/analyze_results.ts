#!/usr/bin/env node

/**
 * Analyzes multi-trial benchmark results
 * Groups experiments by (batch_size, vus, variant) and computes means
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsFile = path.join(__dirname, "../../benchmark-results/12_srid_storage/result.json");

interface ExperimentResult {
  experiment: {
    label: string;
    vus: number;
    batchSize: number;
  };
  metrics: {
    http_reqs?: number;
    http_req_duration?: {
      avg?: number;
      p95?: number;
    };
  };
}

interface AggregatedResult {
  batchSize: number;
  vus: number;
  variant: string;
  throughput_mean: number;
  throughput_min: number;
  throughput_max: number;
  latency_mean_ms: number;
  latency_min_ms: number;
  latency_max_ms: number;
  run_count: number;
}

function parseLabel(label: string): {
  batchSize: number;
  variant: string;
  vus: number;
  run: number;
} | null {
  // Format: single_baseline_vus=20_run1 or batch-1000_native_vus=10_run2
  const match = label.match(
    /^(single|batch-(\d+))_(baseline|native)_vus=(\d+)_run(\d+)$/
  );
  if (!match) return null;

  return {
    batchSize: match[1] === "single" ? 1 : parseInt(match[2]),
    variant: match[3],
    vus: parseInt(match[4]),
    run: parseInt(match[5]),
  };
}

function main() {
  const rawData = JSON.parse(fs.readFileSync(resultsFile, "utf-8"));

  // Group by (batchSize, vus, variant)
  const grouped: Record<
    string,
    { throughputs: number[]; latencies: number[]; count: number }
  > = {};

  for (const exp of rawData.experiments as ExperimentResult[]) {
    const parsed = parseLabel(exp.experiment.label);
    if (!parsed) {
      console.warn(`Could not parse label: ${exp.experiment.label}`);
      continue;
    }

    const key = `${parsed.batchSize}_${parsed.vus}_${parsed.variant}`;
    if (!grouped[key]) {
      grouped[key] = { throughputs: [], latencies: [], count: 0 };
    }

    const throughput = exp.metrics.http_reqs || 0;
    const latency = exp.metrics.http_req_duration?.avg || 0;

    grouped[key].throughputs.push(throughput);
    grouped[key].latencies.push(latency);
    grouped[key].count++;
  }

  // Compute aggregates
  const results: AggregatedResult[] = [];

  for (const [key, data] of Object.entries(grouped)) {
    const [batchSize, vus, variant] = key.split("_");

    const throughputs = data.throughputs.sort((a, b) => a - b);
    const latencies = data.latencies.sort((a, b) => a - b);

    results.push({
      batchSize: parseInt(batchSize),
      vus: parseInt(vus),
      variant,
      throughput_mean: throughputs.reduce((a, b) => a + b, 0) / throughputs.length,
      throughput_min: throughputs[0],
      throughput_max: throughputs[throughputs.length - 1],
      latency_mean_ms: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      latency_min_ms: latencies[0],
      latency_max_ms: latencies[latencies.length - 1],
      run_count: data.count,
    });
  }

  // Sort by batchSize, then vus
  results.sort((a, b) => {
    if (a.batchSize !== b.batchSize) return a.batchSize - b.batchSize;
    return a.vus - b.vus;
  });

  // Print by batch size
  console.log("\n" + "=".repeat(120));
  console.log("MULTI-TRIAL RESULTS (3 runs per variant/vus combo)");
  console.log("=".repeat(120) + "\n");

  const batchSizes = [...new Set(results.map((r) => r.batchSize))];

  for (const batchSize of batchSizes) {
    const batchResults = results.filter((r) => r.batchSize === batchSize);
    const label =
      batchSize === 1
        ? "Single-point Lookups"
        : `Batch-${batchSize} Lookups`;

    console.log(`\n${label}:`);
    console.log("-".repeat(120));
    console.log(
      "VUs    | Variant   | Throughput (mean ± range)       | Latency ms (mean ± range)      | Baseline vs Native"
    );
    console.log("-".repeat(120));

    const vuLevels = [...new Set(batchResults.map((r) => r.vus))];

    for (const vus of vuLevels) {
      const baseline = batchResults.find(
        (r) => r.vus === vus && r.variant === "baseline"
      );
      const native = batchResults.find(
        (r) => r.vus === vus && r.variant === "native"
      );

      if (baseline) {
        const tpRange = `${baseline.throughput_min.toFixed(2)}-${baseline.throughput_max.toFixed(2)}`;
        const latRange = `${baseline.latency_min_ms.toFixed(2)}-${baseline.latency_max_ms.toFixed(2)}`;
        console.log(
          `${vus.toString().padEnd(6)}| baseline  | ${baseline.throughput_mean.toFixed(2).padEnd(8)} (${tpRange.padEnd(15)}) | ${baseline.latency_mean_ms.toFixed(2).padEnd(8)} (${latRange.padEnd(15)}) |`
        );
      }

      if (native) {
        const tpRange = `${native.throughput_min.toFixed(2)}-${native.throughput_max.toFixed(2)}`;
        const latRange = `${native.latency_min_ms.toFixed(2)}-${native.latency_max_ms.toFixed(2)}`;
        const tpDiff =
          baseline && baseline.throughput_mean > 0
            ? (
                ((native.throughput_mean - baseline.throughput_mean) /
                  baseline.throughput_mean) *
                100
              ).toFixed(1)
            : "N/A";
        console.log(
          `${vus.toString().padEnd(6)}| native    | ${native.throughput_mean.toFixed(2).padEnd(8)} (${tpRange.padEnd(15)}) | ${native.latency_mean_ms.toFixed(2).padEnd(8)} (${latRange.padEnd(15)}) | ${tpDiff}%`
        );
      }
    }
  }

  console.log("\n" + "=".repeat(120) + "\n");

  // Summary
  console.log("SUMMARY:");
  console.log(
    "- Native is faster than baseline if % is positive (green), slower if negative (red)"
  );
  console.log("- Range shows min-max across 3 runs (lower range = more stable)");
  console.log("");
}

main();
