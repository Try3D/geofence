#!/usr/bin/env node

/**
 * exp-15: HTTP Runtime Shootout
 *
 * Compares 5 backends executing identical SQL (native 4326, no transform):
 *   express    (Node.js + pg)          → port 3000  /exp/12/native
 *   fastify    (Node.js + pg)          → port 3002  /exp/15/fastify
 *   bun-native (Bun.serve + postgres)  → port 3003  /exp/15/bun-native
 *   bun-elysia (Bun + Elysia + postgres) → port 3004 /exp/15/elysia
 *   axum       (Rust/Tokio + sqlx)     → port 3001  /exp/13/native       (serde_json)
 *   axum-raw   (Rust/Tokio + sqlx)     → port 3001  /exp/13/native-raw   (raw bytes, no serde)
 *
 * Start all backends before running:
 *   cd backend && npm run dev
 *   cd experiments/15_runtime_shootout/backends/axum && cargo run --release
 *   cd experiments/15_runtime_shootout/backends/fastify && npx tsx server.ts
 *   cd experiments/15_runtime_shootout/backends/bun-native && bun server.ts
 *   cd experiments/15_runtime_shootout/backends/bun-elysia && bun server.ts
 *
 * Then: npx tsx experiments/15_runtime_shootout/run.ts
 *
 * Time estimate: 6 backends × 2 test types × 1 run × 3 min = 36 min
 */

import path from "path";
import { fileURLToPath } from "url";
import { Benchmark, randomPoints } from "@geofence/profiler";
import type { K6Config } from "@geofence/profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const URLS = {
  express:   process.env.EXPRESS_URL    ?? "http://localhost:3000",
  axum:      process.env.AXUM_URL       ?? "http://localhost:3001",
  fastify:   process.env.FASTIFY_URL    ?? "http://localhost:3002",
  bunNative: process.env.BUN_NATIVE_URL ?? "http://localhost:3003",
  bunElysia: process.env.BUN_ELYSIA_URL ?? "http://localhost:3004",
};

const BACKENDS = [
  { name: "express",    url: `${URLS.express}/exp/12/native` },
  { name: "fastify",    url: `${URLS.fastify}/exp/15/fastify` },
  { name: "bun-native", url: `${URLS.bunNative}/exp/15/bun-native` },
  { name: "bun-elysia", url: `${URLS.bunElysia}/exp/15/elysia` },
  { name: "axum",       url: `${URLS.axum}/exp/13/native` },       // serde_json round-trip
  { name: "axum-raw",   url: `${URLS.axum}/exp/13/native-raw` },   // raw bytes, no serde
];

function makeExperiments() {
  const exps = [];

  // Run single + batch back-to-back per backend to keep each pool warm
  for (const backend of BACKENDS) {
    exps.push({
      label: `single_${backend.name}_vus=20`,
      vus: 20,
      batchSize: 1,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: backend.url,
        BODY: JSON.stringify({ points: randomPoints(1) }),
        GENERATE_BODY: "true",
      },
    });
    exps.push({
      label: `batch1000_${backend.name}_vus=10`,
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: backend.url,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
        GENERATE_BODY: "true",
      },
    });
  }

  return exps;
}

const k6Config: K6Config = {
  scriptPath: path.join(ROOT, "profiler/k6-runner.js"),
  targetUrl: `${URLS.express}/exp/12/native`,
  method: "POST",
  duration: "180s",
  vus: 20,
};

const bench = new Benchmark({
  name: "HTTP Runtime Shootout: Express vs Fastify vs Bun vs Axum",
  resultsDir: path.join(ROOT, "benchmark-results", "15_runtime_shootout"),
  k6: k6Config,
  experiments: makeExperiments(),
});

await bench.run();
