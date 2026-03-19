/**
 * k6 script for protobuf binary load testing.
 *
 * Opens the pre-encoded binary payload and sends it as application/x-protobuf.
 * Must be run from the experiments/18_serialization_format/ directory OR
 * have the payload-1000.bin file available relative to this script.
 *
 * Env vars:
 *   TARGET_URL  — endpoint to POST to (default: http://localhost:3000/exp/18/proto)
 *   VUS         — virtual users (default: 10)
 *   DURATION    — test duration (default: 60s)
 */

import http from "k6/http";
import { check } from "k6";

// k6 open() reads the file relative to the script at init time (not runtime)
const payload = open("./payload-1000.bin", "b");

export const options = {
  vus: parseInt(__ENV.VUS || "10", 10),
  duration: __ENV.DURATION || "60s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  const url = __ENV.TARGET_URL || "http://localhost:3000/exp/18/proto";
  const res = http.post(url, payload, {
    headers: { "Content-Type": "application/x-protobuf" },
  });
  check(res, { "status 200": (r) => r.status === 200 });
}
