import path from "path";
import { fileURLToPath } from "url";
import {
  fileRegexMutator,
  dockerServiceRestarter,
  portKiller,
  processSpawner,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const minLon = -2.937207, maxLon = 7.016791;
const minLat = 43.238664, maxLat = 49.428801;

function randomPoints(n) {
  return Array.from({ length: n }, () => ({
    lon: minLon + Math.random() * (maxLon - minLon),
    lat: minLat + Math.random() * (maxLat - minLat),
  }));
}

export default {
  name: "Geofence Profiler",
  resultsDir: path.join(ROOT, "benchmark-results"),

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
    pgbouncer: {
      restartFn: dockerServiceRestarter("pgbouncer", ROOT),
    },
    backend: {
      killFn:    portKiller(3000),
      startFn:   processSpawner("npm", ["run", "dev"], path.join(ROOT, "backend")),
      healthUrl: "http://localhost:3000/health",
    },
  },

  k6: {
    scriptPath: path.join(__dirname, "k6-runner.js"),
    targetUrl:  "http://localhost:3000/api/polygons/batch",
    method:     "POST",
    duration:   "60s",
    buildPayload: (exp) =>
      JSON.stringify({ points: randomPoints(exp.batchSize ?? 1000), limit: 20 }),
  },

  metrics: ["throughput", "pointLookups", "avgLatency", "p95Latency", "p99Latency", "failureRate", "totalRequests"],

  experiments: [
    // Vary VUs at fixed batch=1000, fixed pools
    { label: "batch=1000 vus=2",  apiPool: 15, pgPool: 25, vus: 2,  batchSize: 1000 },
    { label: "batch=1000 vus=5",  apiPool: 15, pgPool: 25, vus: 5,  batchSize: 1000 },
    { label: "batch=1000 vus=10", apiPool: 15, pgPool: 25, vus: 10, batchSize: 1000 },
    { label: "batch=1000 vus=20", apiPool: 15, pgPool: 25, vus: 20, batchSize: 1000 },

    // Vary batch size at fixed vus=5
    { label: "batch=100  vus=5",  apiPool: 15, pgPool: 25, vus: 5,  batchSize: 100  },
    { label: "batch=10   vus=5",  apiPool: 15, pgPool: 25, vus: 5,  batchSize: 10   },
    { label: "batch=1    vus=5",  apiPool: 15, pgPool: 25, vus: 5,  batchSize: 1,
      // single-point uses GET endpoint
      extraEnv: { TARGET_URL: "http://localhost:3000/api/polygons/contains?lon=2.3&lat=48.8&limit=20", METHOD: "GET" },
    },
  ],
};
