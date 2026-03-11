#!/usr/bin/env node

/**
 * Compares three batch strategies for the geofence API:
 *   1. serial   — single LATERAL query (existing /batch)
 *   2. parallel — LATERAL chunked via Promise.all (/batch-parallel)
 *   3. set-join — direct spatial JOIN without LATERAL (/batch-set)
 *
 * Measures point-lookups/sec and latency at multiple concurrency levels.
 */

import path from "path";
import { fileURLToPath } from "url";
import { runProfiler, portKiller, processSpawner } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const PROFILER_DIR = path.join(ROOT, "profiler");

const minLon = -2.937207, maxLon = 7.016791;
const minLat = 43.238664, maxLat = 49.428801;

function randomPoints(n) {
  return Array.from({ length: n }, () => ({
    lon: minLon + Math.random() * (maxLon - minLon),
    lat: minLat + Math.random() * (maxLat - minLat),
  }));
}

await runProfiler({
  name: "Batch Strategy Comparison (serial vs parallel vs set-join)",
  resultsDir: path.join(ROOT, "benchmark-results", "03_parallel_batch"),

  services: {
    backend: {
      killFn:    portKiller(3000),
      startFn:   processSpawner("npm", ["run", "dev"], path.join(ROOT, "backend")),
      healthUrl: "http://localhost:3000/health",
    },
  },

  k6: {
    scriptPath: path.join(PROFILER_DIR, "k6-runner.js"),
    duration:   "60s",
  },

  metrics: ["throughput", "pointLookups", "avgLatency", "p95Latency", "p99Latency", "failureRate"],

  experiments: [
    // ── Serial LATERAL (baseline) ────────────────────────────────────────────
    {
      label: "serial vus=5",
      vus: 5, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "serial vus=10",
      vus: 10, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },

    // ── Parallel chunks via Promise.all ──────────────────────────────────────
    {
      label: "parallel vus=5",
      vus: 5, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch-parallel",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "parallel vus=10",
      vus: 10, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch-parallel",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },

    // ── Set-join (no LATERAL) ────────────────────────────────────────────────
    {
      label: "set-join vus=5",
      vus: 5, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch-set",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "set-join vus=10",
      vus: 10, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch-set",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
  ],
});
