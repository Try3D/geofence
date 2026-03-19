#!/usr/bin/env node
/**
 * Benchmarks JSON vs JSON-flat vs Protobuf serialization for batch geofence lookups.
 *
 * Hypothesis: binary protobuf reduces payload size (~16 KB vs ~42 KB) and
 * eliminates JSON parse/stringify overhead, lowering latency and increasing
 * throughput — especially at high VU counts where serialization becomes
 * a larger share of total request time.
 *
 * Phase 1: JSON variants (json, json-flat) via standard k6-runner.js
 * Phase 2: Proto variant via custom k6-proto.js (binary payload)
 *
 * 3 variants × 3 VU levels = 9 k6 runs total
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints } from "@geofence/profiler";
import protobuf from "protobufjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, "../..");
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const RESULTS_DIR = path.join(ROOT, "benchmark-results", "16_serialization_format");
const PROTO_RUNNER = path.join(__dirname, "k6-proto.js");
const PAYLOAD_PATH = path.join(__dirname, "payload-1000.bin");

// Reuse the standard k6 runner from profiler
import { GEOFENCE_PRESETS } from "@geofence/profiler";
const K6_RUNNER = GEOFENCE_PRESETS.k6.scriptPath;

const VU_LEVELS = [10, 50, 100];
const BATCH_SIZE = 1000;

// ── Phase 0: Generate protobuf binary payload ─────────────────────────────────

async function generateProtobufPayload(): Promise<void> {
  console.log("Generating protobuf binary payload...");
  const root = await protobuf.load(path.join(__dirname, "schema.proto"));
  const PointBatch = root.lookupType("PointBatch");

  const pts = randomPoints(BATCH_SIZE);
  const lons = pts.map((p) => p.lon);
  const lats = pts.map((p) => p.lat);

  const message = PointBatch.create({ lons, lats });
  const encoded = PointBatch.encode(message).finish();
  fs.writeFileSync(PAYLOAD_PATH, encoded);
  console.log(`  payload-1000.bin: ${encoded.length} bytes\n`);
}

// ── Phase 1: JSON variants ────────────────────────────────────────────────────

const jsonExperiments = VU_LEVELS.flatMap((vus) => [
  {
    label: `json_1000_vus=${vus}`,
    vus,
    batchSize: BATCH_SIZE,
    extraEnv: {
      METHOD: "POST",
      TARGET_URL: `${BASE_URL}/exp/16/json`,
      BODY: JSON.stringify({ points: randomPoints(BATCH_SIZE) }),
      GENERATE_BODY: "true",
    },
  },
  {
    label: `json-flat_1000_vus=${vus}`,
    vus,
    batchSize: BATCH_SIZE,
    extraEnv: {
      METHOD: "POST",
      TARGET_URL: `${BASE_URL}/exp/16/json-flat`,
      BODY: (() => {
        const pts = randomPoints(BATCH_SIZE);
        return JSON.stringify({
          lons: pts.map((p) => p.lon),
          lats: pts.map((p) => p.lat),
        });
      })(),
      GENERATE_BODY: "true",
    },
  },
]);

const jsonBench = new Benchmark({
  name: "16 —JSON vs JSON-flat Serialization",
  resultsDir: path.join(RESULTS_DIR, "json"),
  mutators: {},
  services: {},
  k6: {
    scriptPath: K6_RUNNER,
    targetUrl: `${BASE_URL}/exp/16/json`,
    method: "POST",
    duration: "60s",
  },
  experiments: jsonExperiments,
});

// ── Phase 2: Protobuf variant ─────────────────────────────────────────────────

const protoExperiments = VU_LEVELS.map((vus) => ({
  label: `proto_1000_vus=${vus}`,
  vus,
  batchSize: BATCH_SIZE,
  extraEnv: {
    TARGET_URL: `${BASE_URL}/exp/16/proto`,
    DURATION: "60s",
  },
}));

const protoBench = new Benchmark({
  name: "16 —Protobuf Serialization",
  resultsDir: path.join(RESULTS_DIR, "proto"),
  mutators: {},
  services: {},
  k6: {
    scriptPath: PROTO_RUNNER,
    targetUrl: `${BASE_URL}/exp/16/proto`,
    method: "POST",
    duration: "60s",
  },
  experiments: protoExperiments,
});

// ── Run ───────────────────────────────────────────────────────────────────────

await generateProtobufPayload();
await jsonBench.run();
await protoBench.run();
