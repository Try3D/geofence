#!/usr/bin/env node

/**
 * Compares three batch strategies for the geofence API:
 *   1. JSON expansion  — set-based join with JSON array unnesting and aggregation (/batch-json)
 *   2. Temp table      — temp table load with spatial join and aggregation (/batch-temp)
 *   3. Serial LATERAL  — baseline serial approach via LATERAL (/batch)
 *
 * Measures point-lookups/sec and latency across:
 *   - Batch sizes: 100, 1000
 *   - Concurrency (VUs): 5, 10, 20
 *   - Tables: planet_osm_polygon, planet_osm_polygon_simple_10
 *
 * All methods return identical output structure:
 *   { idx, matches: [{osm_id, name}, ...] }
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Batch Algorithm Comparison (JSON expansion vs Temp table vs Serial LATERAL)",
  resultsDir: path.join(ROOT, "benchmark-results", "05_batch_algorithms"),

  mutators: GEOFENCE_PRESETS.mutators,
  services: {
    backend: GEOFENCE_PRESETS.services.backend,
  },
  k6: GEOFENCE_PRESETS.k6,

  experiments: [
    // ── Batch size 100, original table ───────────────────────────────────────
    {
      label: "json_100_vus=5",
      vus: 5,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },
    {
      label: "json_100_vus=10",
      vus: 10,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },
    {
      label: "json_100_vus=20",
      vus: 20,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },

    {
      label: "temp_100_vus=5",
      vus: 5,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },
    {
      label: "temp_100_vus=10",
      vus: 10,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },
    {
      label: "temp_100_vus=20",
      vus: 20,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },

    {
      label: "serial_100_vus=5",
      vus: 5,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },
    {
      label: "serial_100_vus=10",
      vus: 10,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },
    {
      label: "serial_100_vus=20",
      vus: 20,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch`,
        BODY: JSON.stringify({ points: randomPoints(100) }),
      },
    },

    // ── Batch size 1000, original table ──────────────────────────────────────
    {
      label: "json_1000_vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "json_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "json_1000_vus=20",
      vus: 20,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    {
      label: "temp_1000_vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "temp_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "temp_1000_vus=20",
      vus: 20,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    {
      label: "serial_1000_vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "serial_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    {
      label: "serial_1000_vus=20",
      vus: 20,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },

    // ── Batch size 100, simplified geometry (simple_10) ──────────────────────
    {
      label: "json_100_simple10_vus=5",
      vus: 5,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(100), table: "planet_osm_polygon_simple_10" }),
      },
    },
    {
      label: "json_100_simple10_vus=10",
      vus: 10,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(100), table: "planet_osm_polygon_simple_10" }),
      },
    },

    {
      label: "temp_100_simple10_vus=5",
      vus: 5,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(100), table: "planet_osm_polygon_simple_10" }),
      },
    },
    {
      label: "temp_100_simple10_vus=10",
      vus: 10,
      batchSize: 100,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(100), table: "planet_osm_polygon_simple_10" }),
      },
    },

    // ── Batch size 1000, simplified geometry (simple_10) ──────────────────────
    {
      label: "json_1000_simple10_vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(1000), table: "planet_osm_polygon_simple_10" }),
      },
    },
    {
      label: "json_1000_simple10_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-json`,
        BODY: JSON.stringify({ points: randomPoints(1000), table: "planet_osm_polygon_simple_10" }),
      },
    },

    {
      label: "temp_1000_simple10_vus=5",
      vus: 5,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(1000), table: "planet_osm_polygon_simple_10" }),
      },
    },
    {
      label: "temp_1000_simple10_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/05/batch-temp`,
        BODY: JSON.stringify({ points: randomPoints(1000), table: "planet_osm_polygon_simple_10" }),
      },
    },
  ],
});

await bench.run();
