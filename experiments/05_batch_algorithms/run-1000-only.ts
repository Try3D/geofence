#!/usr/bin/env node

/**
 * Simplified batch comparison: batch size 1000 only, 9 experiments total
 * - Methods: json, temp, serial
 * - VUs: 5, 10, 20
 * - Table: planet_osm_polygon only (no simple_10)
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Batch Size 1000 Comparison (JSON vs Temp vs Serial LATERAL)",
  resultsDir: path.join(ROOT, "benchmark-results", "05_batch_algorithms_1000"),

  mutators: GEOFENCE_PRESETS.mutators,
  services: {
    backend: GEOFENCE_PRESETS.services.backend,
  },
  k6: GEOFENCE_PRESETS.k6,

  experiments: [
    // JSON expansion
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

    // Temp table
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

    // Serial LATERAL (baseline)
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
  ],
});

await bench.run();
