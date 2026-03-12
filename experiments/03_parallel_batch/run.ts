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
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Batch Strategy Comparison (serial vs parallel vs set-join)",
  resultsDir: path.join(ROOT, "benchmark-results", "03_parallel_batch"),

  mutators: GEOFENCE_PRESETS.mutators,
  services: {
    backend: GEOFENCE_PRESETS.services.backend,
  },
  k6: GEOFENCE_PRESETS.k6,

  experiments: [
    // ── Serial LATERAL (baseline) ────────────────────────────────────────────
    {
      label: "serial vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/03/batch`,
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "serial vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/03/batch`,
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },

    // ── Parallel chunks via Promise.all ──────────────────────────────────────
    {
      label: "parallel vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/03/batch-parallel`,
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "parallel vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/03/batch-parallel`,
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },

    // ── Set-join (no LATERAL) ────────────────────────────────────────────────
    {
      label: "set-join vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/03/batch-set`,
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
    {
      label: "set-join vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/03/batch-set`,
        BODY: JSON.stringify({ points: randomPoints(1000), limit: 20 }),
      },
    },
  ],
});

await bench.run();
