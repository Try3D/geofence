import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const method    = __ENV.METHOD     || "GET";
const targetUrl = __ENV.TARGET_URL || "http://localhost:3000";
const body      = __ENV.BODY       || null;
const vus       = Number(__ENV.VUS       || 10);
const duration  = __ENV.DURATION         || "60s";
const batchSize = Number(__ENV.BATCH_SIZE || 1);

const pointLookups = batchSize > 1 ? new Counter("point_lookups") : null;

export const options = {
  vus,
  duration,
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  let response;

  if (method === "POST") {
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
