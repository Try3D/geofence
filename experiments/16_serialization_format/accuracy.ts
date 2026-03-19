#!/usr/bin/env node
/**
 * Accuracy test for exp-18: Verify json, json-flat, and proto endpoints
 * all return identical hierarchy results for the same input points.
 *
 * Serialization format must not affect query results — only wire size and
 * parse/encode overhead differ.
 *
 * Run: npx tsx experiments/18_serialization_format/accuracy.ts
 */

import path from "path";
import { fileURLToPath } from "url";
import { randomPoints } from "@geofence/profiler";
import protobuf from "protobufjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

interface HierarchyEntry {
  id: number | null;
  osm_id: number;
  name: string;
  admin_level: number;
  depth: number;
}

interface JsonResult {
  count: number;
  results: Array<{ idx: number; hierarchy: HierarchyEntry[] }>;
}

// Load proto schema for decoding responses
const root = await protobuf.load(path.join(__dirname, "schema.proto"));
const PointBatchType = root.lookupType("PointBatch");
const BatchResponseType = root.lookupType("BatchResponse");

async function postJson(
  points: Array<{ lon: number; lat: number }>
): Promise<JsonResult> {
  const res = await fetch(`${BASE_URL}/exp/16/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });
  if (!res.ok) throw new Error(`/json HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<JsonResult>;
}

async function postJsonFlat(
  points: Array<{ lon: number; lat: number }>
): Promise<JsonResult> {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const res = await fetch(`${BASE_URL}/exp/16/json-flat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lons, lats }),
  });
  if (!res.ok) throw new Error(`/json-flat HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<JsonResult>;
}

async function postProto(
  points: Array<{ lon: number; lat: number }>
): Promise<JsonResult> {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const encoded = PointBatchType.encode(
    PointBatchType.create({ lons, lats })
  ).finish();

  const res = await fetch(`${BASE_URL}/exp/16/proto`, {
    method: "POST",
    headers: { "Content-Type": "application/x-protobuf" },
    body: encoded,
  });
  if (!res.ok) throw new Error(`/proto HTTP ${res.status}: ${await res.text()}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const decoded = BatchResponseType.decode(buf) as unknown as {
    count: number;
    results: Array<{
      idx: number;
      hierarchy: Array<{
        id: string;
        osmId: string;
        name: string;
        adminLevel: number;
        depth: number;
      }>;
    }>;
  };

  // Normalize proto response to match JSON shape
  return {
    count: decoded.count,
    results: decoded.results.map((r) => ({
      idx: r.idx,
      hierarchy: r.hierarchy.map((h) => ({
        id: Number(h.id),
        osm_id: Number(h.osmId),
        name: h.name,
        admin_level: h.adminLevel,
        depth: h.depth,
      })),
    })),
  };
}

function compareResults(
  a: JsonResult,
  b: JsonResult,
  labelA: string,
  labelB: string
): number {
  let mismatches = 0;
  for (let i = 0; i < a.results.length; i++) {
    const ha = JSON.stringify(a.results[i].hierarchy);
    const hb = JSON.stringify(b.results[i].hierarchy);
    if (ha !== hb) {
      mismatches++;
      if (mismatches <= 3) {
        console.error(`  Mismatch at index ${i}:`);
        console.error(`    ${labelA}: ${ha}`);
        console.error(`    ${labelB}: ${hb}`);
      }
    }
  }
  return mismatches;
}

async function runAccuracy() {
  console.log("exp-18 accuracy: verifying json === json-flat === proto\n");

  const testSizes = [1, 10, 100, 200];
  let allPassed = true;

  for (const size of testSizes) {
    const points = randomPoints(size);

    const [jsonData, flatData, protoData] = await Promise.all([
      postJson(points),
      postJsonFlat(points),
      postProto(points),
    ]);

    const flatMismatches = compareResults(jsonData, flatData, "json", "json-flat");
    const protoMismatches = compareResults(jsonData, protoData, "json", "proto");

    if (flatMismatches === 0 && protoMismatches === 0) {
      console.log(`✓ size=${size}: all ${size} results identical across all 3 variants`);
    } else {
      if (flatMismatches > 0) {
        console.error(`✗ size=${size}: json vs json-flat: ${flatMismatches}/${size} mismatches`);
      }
      if (protoMismatches > 0) {
        console.error(`✗ size=${size}: json vs proto: ${protoMismatches}/${size} mismatches`);
      }
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log("\n✓ All accuracy checks passed — serialization format is result-transparent");
  } else {
    console.error("\n✗ Accuracy failures detected");
    process.exit(1);
  }
}

runAccuracy().catch((err) => {
  console.error(err);
  process.exit(1);
});
