#!/usr/bin/env node

/**
 * Analyze multi-trial VU sweep results
 * Groups experiments by VU level and computes mean/std across runs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultFile = path.join(__dirname, "../../benchmark-results/12_srid_storage/result.json");

const data = JSON.parse(fs.readFileSync(resultFile, "utf8"));

// Group by size_variant_vus
const grouped = {};

for (const entry of data.experiments) {
  if (!entry.metrics) continue; // skip null metrics

  const label = entry.experiment.label;
  // Parse label: "batch-1000_baseline_vus=5_run1"
  const match = label.match(/^(single|batch-\d+)_(\w+)_vus=(\d+)_run\d+$/);
  if (!match) continue;

  const [, size, variant, vus] = match;
  const key = `${size}_${variant}_${vus}`;

  if (!grouped[key]) {
    grouped[key] = [];
  }

  grouped[key].push({
    throughput: entry.metrics.throughput,
    latency: entry.metrics.avgLatency,
  });
}

// Compute means and ranges
console.log("\n=== Multi-Trial Results Summary ===\n");

// Single-point results
console.log("## Single-Point Lookups\n");
const singleVUs = [10, 20, 40];
for (const vus of singleVUs) {
  const baselineKey = `single_baseline_${vus}`;
  const nativeKey = `single_native_${vus}`;

  const baseline = grouped[baselineKey] || [];
  const native = grouped[nativeKey] || [];

  if (baseline.length === 0 || native.length === 0) continue;

  const baselineTP = baseline.map((x) => x.throughput);
  const baselineLatency = baseline.map((x) => x.latency);
  const nativeTP = native.map((x) => x.throughput);
  const nativeLatency = native.map((x) => x.latency);

  const mean = (arr) => arr.reduce((a, b) => a + b) / arr.length;
  const minmax = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return [sorted[0], sorted[sorted.length - 1]];
  };

  console.log(`### VUs: ${vus}`);
  console.log(`| Variant | Throughput (req/s) | Avg Latency (ms) |`);
  console.log(`|---------|------------------|------------------|`);

  const basTP = mean(baselineTP);
  const basLat = mean(baselineLatency);
  const [basTPMin, basTPMax] = minmax(baselineTP);
  const [basLatMin, basLatMax] = minmax(baselineLatency);

  const natTP = mean(nativeTP);
  const natLat = mean(nativeLatency);
  const [natTPMin, natTPMax] = minmax(nativeTP);
  const [natLatMin, natLatMax] = minmax(nativeLatency);

  console.log(
    `| baseline | ${basTP.toFixed(0)} (${basTPMin.toFixed(0)}–${basTPMax.toFixed(0)}) | ${basLat.toFixed(2)} (${basLatMin.toFixed(2)}–${basLatMax.toFixed(2)}) |`
  );
  console.log(
    `| native | ${natTP.toFixed(0)} (${natTPMin.toFixed(0)}–${natTPMax.toFixed(0)}) | ${natLat.toFixed(2)} (${natLatMin.toFixed(2)}–${natLatMax.toFixed(2)}) |`
  );

  const tpDiff = ((natTP - basTP) / basTP) * 100;
  const latDiff = ((natLat - basLat) / basLat) * 100;
  const sign = (n) => (n > 0 ? "+" : "");

  console.log(
    `| **Diff** | **${sign(tpDiff)}${tpDiff.toFixed(1)}%** | **${sign(latDiff)}${latDiff.toFixed(1)}%** |`
  );
  console.log();
}

// Batch-1000 results
console.log("\n## Batch-1000 Lookups\n");
const batchVUs = [5, 10, 20];
for (const vus of batchVUs) {
  const baselineKey = `batch-1000_baseline_${vus}`;
  const nativeKey = `batch-1000_native_${vus}`;

  const baseline = grouped[baselineKey] || [];
  const native = grouped[nativeKey] || [];

  if (baseline.length === 0 || native.length === 0) {
    console.log(`### VUs: ${vus} — No data`);
    console.log();
    continue;
  }

  const baselineTP = baseline.map((x) => x.throughput);
  const baselineLatency = baseline.map((x) => x.latency);
  const nativeTP = native.map((x) => x.throughput);
  const nativeLatency = native.map((x) => x.latency);

  const mean = (arr) => arr.reduce((a, b) => a + b) / arr.length;
  const minmax = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return [sorted[0], sorted[sorted.length - 1]];
  };

  console.log(`### VUs: ${vus}`);
  console.log(`| Variant | Throughput (req/s) | Avg Latency (ms) |`);
  console.log(`|---------|------------------|------------------|`);

  const basTP = mean(baselineTP);
  const basLat = mean(baselineLatency);
  const [basTPMin, basTPMax] = minmax(baselineTP);
  const [basLatMin, basLatMax] = minmax(baselineLatency);

  const natTP = mean(nativeTP);
  const natLat = mean(nativeLatency);
  const [natTPMin, natTPMax] = minmax(nativeTP);
  const [natLatMin, natLatMax] = minmax(nativeLatency);

  console.log(
    `| baseline | ${basTP.toFixed(2)} (${basTPMin.toFixed(2)}–${basTPMax.toFixed(2)}) | ${basLat.toFixed(0)} (${basLatMin.toFixed(0)}–${basLatMax.toFixed(0)}) |`
  );
  console.log(
    `| native | ${natTP.toFixed(2)} (${natTPMin.toFixed(2)}–${natTPMax.toFixed(2)}) | ${natLat.toFixed(0)} (${natLatMin.toFixed(0)}–${natLatMax.toFixed(0)}) |`
  );

  const tpDiff = ((natTP - basTP) / basTP) * 100;
  const latDiff = ((natLat - basLat) / basLat) * 100;
  const sign = (n) => (n > 0 ? "+" : "");

  console.log(
    `| **Diff** | **${sign(tpDiff)}${tpDiff.toFixed(1)}%** | **${sign(latDiff)}${latDiff.toFixed(1)}%** |`
  );
  console.log();
}

console.log("Analysis complete. Copy tables above to update README.md");
