#!/usr/bin/env node

/**
 * Benchmarks JIT impact on query performance.
 *
 * Compares performance with JIT ON vs JIT OFF across different batch sizes:
 * - Batch sizes: 10, 50, 100 points
 * - JIT states: OFF (jit=off), ON (jit=on)
 * - Total: 6 experiments (3 sizes × 2 JIT states)
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

/**
 * Toggle JIT setting via backend endpoint
 */
async function toggleJit(enabled: boolean): Promise<void> {
  try {
    const jitValue = enabled ? "on" : "off";
    const cmd = `curl -s -X POST "${BASE_URL}/exp/09/toggle-jit" -H "Content-Type: application/json" -d '{"jit":${enabled}}'`;
    execSync(cmd, { stdio: "pipe" });
    // Small wait for config to propagate
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err) {
    console.warn(`⚠️  Failed to toggle JIT: ${err}`);
  }
}

const bench = new Benchmark({
  name: "JIT Impact on Query Performance",
  resultsDir: path.join(ROOT, "benchmark-results", "09_jit_impact"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Batch Size 10 ────────────────────────────────────────────────────────
    {
      label: "batch-10_jit-off_vus=10",
      jitState: false,
      batchSize: 10,
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/09/lookup`,
        BODY: JSON.stringify({
          points: randomPoints(10),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-10_jit-on_vus=10",
      jitState: true,
      batchSize: 10,
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/09/lookup`,
        BODY: JSON.stringify({
          points: randomPoints(10),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },

    // ── Batch Size 50 ────────────────────────────────────────────────────────
    {
      label: "batch-50_jit-off_vus=10",
      jitState: false,
      batchSize: 50,
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/09/lookup`,
        BODY: JSON.stringify({
          points: randomPoints(50),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-50_jit-on_vus=10",
      jitState: true,
      batchSize: 50,
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/09/lookup`,
        BODY: JSON.stringify({
          points: randomPoints(50),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },

    // ── Batch Size 100 ───────────────────────────────────────────────────────
    {
      label: "batch-100_jit-off_vus=10",
      jitState: false,
      batchSize: 100,
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/09/lookup`,
        BODY: JSON.stringify({
          points: randomPoints(100),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
    {
      label: "batch-100_jit-on_vus=10",
      jitState: true,
      batchSize: 100,
      vus: 10,
      duration: "60s",
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/09/lookup`,
        BODY: JSON.stringify({
          points: randomPoints(100),
          table: "planet_osm_polygon",
          limit: 20,
        }),
      },
    },
  ],
});

console.log("\n🔧 JIT toggling via /exp/09/toggle-jit endpoint");
console.log("⚠️  Requires PostgreSQL superuser permissions\n");

// Wrap the run method to inject JIT toggling before k6 runs
const originalRunK6 = (bench as any).runK6.bind(bench);
(bench as any).runK6 = async function (expNum: number, exp: any) {
  if (exp.jitState !== undefined) {
    const jitValue = exp.jitState ? "on" : "off";
    console.log(`  → toggle JIT = ${jitValue}`);
    await toggleJit(exp.jitState);
  }
  return originalRunK6(expNum, exp);
};

await bench.run();
