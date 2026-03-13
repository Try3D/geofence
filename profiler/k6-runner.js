import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const method    = __ENV.METHOD     || "GET";
const targetUrl = __ENV.TARGET_URL || "http://localhost:3000";
const staticBody = __ENV.BODY       || null;
const vus       = Number(__ENV.VUS       || 10);
const duration  = __ENV.DURATION         || "60s";
const batchSize = Number(__ENV.BATCH_SIZE || 1);
const generateBody = __ENV.GENERATE_BODY === "true"; // flag to regenerate body per iteration

const pointLookups = batchSize > 1 ? new Counter("point_lookups") : null;

export const options = {
  vus,
  duration,
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};

// Helper: generate random points (France bounds)
function randomPoints(count) {
  const minLat = 43.238664;
  const maxLat = 49.428801;
  const minLon = -2.937207;
  const maxLon = 7.016791;

  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lat: minLat + Math.random() * (maxLat - minLat),
      lon: minLon + Math.random() * (maxLon - minLon),
    });
  }
  return points;
}

export default function () {
  let response;
  let body = staticBody;

  if (method === "POST") {
    // If GENERATE_BODY flag is set, regenerate body per iteration
    if (generateBody && staticBody) {
      const baseBody = JSON.parse(staticBody);
      if (staticBody.includes('"points":')) {
        // Batch: regenerate points array
        baseBody.points = randomPoints(batchSize);
      } else {
        // Single-point: regenerate lat/lon
        const [p] = randomPoints(1);
        baseBody.lat = p.lat;
        baseBody.lon = p.lon;
      }
      body = JSON.stringify(baseBody);
    }

    response = http.post(targetUrl, body, {
      headers: { "Content-Type": "application/json" },
      timeout: "120s",
    });
  } else {
    response = http.get(targetUrl, { timeout: "30s" });
  }

  const ok = check(response, {
    "status is 200": (r) => r.status === 200,
  });

  if (ok && pointLookups) {
    pointLookups.add(batchSize);
  }
}
