#!/usr/bin/env node

/**
 * Benchmarks proximity cache variants (1km, 2km, 5km, 10km) vs no-cache
 *
 * Single-point requests — fresh random Spain point per iteration.
 * Redis is NOT flushed between runs (represents a warm real-world cache).
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

// Seed body — GENERATE_BODY will replace lat/lon per iteration
const singlePoint = randomPoints(1)[0];
const baseBody = JSON.stringify({ lat: singlePoint.lat, lon: singlePoint.lon, table: "planet_osm_polygon" });

const bench = new Benchmark({
  name: "Proximity Cache — no-cache vs 1km/2km/5km/10km (single point, warm Redis)",
  resultsDir: path.join(ROOT, "benchmark-results", "06_spatial_tile_cache"),

  ...GEOFENCE_PRESETS,

  experiments: [
    {
      label: "no-cache_vus=10",
      vus: 10,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/no-cache`,
        BODY: baseBody,
        GENERATE_BODY: "true",
      },
    },
    {
      label: "cache-1km_vus=10",
      vus: 10,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache-1km`,
        BODY: baseBody,
        GENERATE_BODY: "true",
      },
    },
    {
      label: "cache-2km_vus=10",
      vus: 10,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache-2km`,
        BODY: baseBody,
        GENERATE_BODY: "true",
      },
    },
    {
      label: "cache-5km_vus=10",
      vus: 10,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache-5km`,
        BODY: baseBody,
        GENERATE_BODY: "true",
      },
    },
    {
      label: "cache-10km_vus=10",
      vus: 10,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/06/cache-10km`,
        BODY: baseBody,
        GENERATE_BODY: "true",
      },
    },
  ],
});

await bench.run();
