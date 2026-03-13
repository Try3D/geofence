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

// Helper: generate random points (Spain bounds)
function randomPoints(count) {
  const minLat = 36.0;
  const maxLat = 43.8;
  const minLon = -9.5;
  const maxLon = 3.3;

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
    // If GENERATE_BODY flag is set, regenerate points for each iteration
    if (generateBody && staticBody && staticBody.includes('"points":')) {
      const newPoints = randomPoints(batchSize);
      const baseBody = JSON.parse(staticBody);
      baseBody.points = newPoints;
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
