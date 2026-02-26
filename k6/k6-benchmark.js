import http from "k6/http";
import { check, sleep } from "k6";

const targetUrl =
  __ENV.TARGET_URL || "http://localhost:3001/api/polygons/contains";
const limit = Number(__ENV.LIMIT || 20);
const thinkMs = Number(__ENV.THINK_MS || 0);

const minLon = 68.11;
const maxLon = 97.42;
const minLat = 6.46;
const maxLat = 37.08;

function randomPointInIndiaBounds() {
  return {
    lon: minLon + Math.random() * (maxLon - minLon),
    lat: minLat + Math.random() * (maxLat - minLat),
  };
}

export const options = {
  stages: [
    { duration: "15s", target: 10000 },
    { duration: "15s", target: 10000 },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<300", "p(99)<700"],
  },
};

export default function () {
  const point = randomPointInIndiaBounds();
  const url = `${targetUrl}?lon=${point.lon}&lat=${point.lat}&limit=${limit}`;
  const response = http.get(url, { timeout: "30s" });

  check(response, {
    "status is 200": (r) => r.status === 200,
    "body is json": (r) =>
      r.headers["Content-Type"] &&
      r.headers["Content-Type"].includes("application/json"),
  });

  if (thinkMs > 0) {
    sleep(thinkMs / 1000);
  }
}
