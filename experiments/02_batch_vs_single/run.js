#!/usr/bin/env node

/**
 * Compares single-point vs batch throughput for the geofence API.
 * Measures point-lookups/sec for each approach at the same concurrency.
 */

import path from "path";
import { fileURLToPath } from "url";
import { runProfiler, fileRegexMutator, dockerServiceRestarter, portKiller, processSpawner } from "@geofence/profiler";

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

function randomPoint() {
  return randomPoints(1)[0];
}

await runProfiler({
  name: "Single vs Batch Throughput Comparison",
  resultsDir: path.join(ROOT, "benchmark-results", "02_batch_vs_single"),

  mutators: {
    apiPool: fileRegexMutator(
      path.join(ROOT, "backend/src/db.ts"),
      /max:\s*\d+/,
      (v) => `max: ${v}`
    ),
    pgPool: fileRegexMutator(
      path.join(ROOT, "pgbouncer.ini"),
      /default_pool_size\s*=\s*\d+/,
      (v) => `default_pool_size = ${v}`
    ),
  },

  services: {
    pgbouncer: { restartFn: dockerServiceRestarter("pgbouncer", ROOT) },
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
    // ── Single-point: 1 lookup per request ──────────────────────────────────
    {
      label:     "single vus=5",
      apiPool: 15, pgPool: 25, vus: 5, batchSize: 1,
      extraEnv: {
        METHOD:     "GET",
        TARGET_URL: `http://localhost:3000/api/polygons/contains?lon=${randomPoint().lon}&lat=${randomPoint().lat}&limit=20`,
      },
    },
    {
      label:     "single vus=15",
      apiPool: 15, pgPool: 25, vus: 15, batchSize: 1,
      extraEnv: {
        METHOD:     "GET",
        TARGET_URL: `http://localhost:3000/api/polygons/contains?lon=${randomPoint().lon}&lat=${randomPoint().lat}&limit=20`,
      },
    },
    {
      label:     "single vus=25",
      apiPool: 15, pgPool: 25, vus: 25, batchSize: 1,
      extraEnv: {
        METHOD:     "GET",
        TARGET_URL: `http://localhost:3000/api/polygons/contains?lon=${randomPoint().lon}&lat=${randomPoint().lat}&limit=20`,
      },
    },

    // ── Batch: 1000 lookups per request ─────────────────────────────────────
    {
      label:     "batch=1000 vus=5",
      apiPool: 15, pgPool: 25, vus: 5, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label:     "batch=1000 vus=10",
      apiPool: 15, pgPool: 25, vus: 10, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label:     "batch=1000 vus=20",
      apiPool: 15, pgPool: 25, vus: 20, batchSize: 1000,
      extraEnv: {
        METHOD:     "POST",
        TARGET_URL: "http://localhost:3000/api/polygons/batch",
        BODY:       JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
  ],
});
