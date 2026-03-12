#!/usr/bin/env node

/**
 * Benchmarks connection pool size configurations for the geofence API.
 * Tests various API pool sizes and PgBouncer pool sizes in combination.
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const bench = new Benchmark({
  name: "Connection Pool Size Optimization",
  resultsDir: path.join(ROOT, "benchmark-results", "01_connection_pooling"),

  ...GEOFENCE_PRESETS,

  experiments: [
    // ── Varying API pool sizes ────────────────────────────────────────────────
    {
      label: "API pool=10, PG pool=20",
      apiPool: 10,
      pgPool: 20,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/01/batch`,
        BODY: JSON.stringify({ points: [], limit: 20 }),
      },
    },
    {
      label: "API pool=15, PG pool=25",
      apiPool: 15,
      pgPool: 25,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/01/batch`,
        BODY: JSON.stringify({ points: [], limit: 20 }),
      },
    },
    {
      label: "API pool=20, PG pool=25",
      apiPool: 20,
      pgPool: 25,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/01/batch`,
        BODY: JSON.stringify({ points: [], limit: 20 }),
      },
    },
    {
      label: "API pool=25, PG pool=25",
      apiPool: 25,
      pgPool: 25,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/01/batch`,
        BODY: JSON.stringify({ points: [], limit: 20 }),
      },
    },
    {
      label: "API pool=30, PG pool=25",
      apiPool: 30,
      pgPool: 25,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/01/batch`,
        BODY: JSON.stringify({ points: [], limit: 20 }),
      },
    },
    {
      label: "API pool=35, PG pool=25",
      apiPool: 35,
      pgPool: 25,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/01/batch`,
        BODY: JSON.stringify({ points: [], limit: 20 }),
      },
    },
    {
      label: "API pool=40, PG pool=25",
      apiPool: 40,
      pgPool: 25,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/01/batch`,
        BODY: JSON.stringify({ points: [], limit: 20 }),
      },
    },
  ],
});

await bench.run();
