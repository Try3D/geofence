#!/usr/bin/env node
/**
 * Generates a binary protobuf payload of 1000 random points.
 * Output: experiments/18_serialization_format/payload-1000.bin
 *
 * Run: npx tsx experiments/18_serialization_format/generate-payload.ts
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import protobuf from "protobufjs";
import { randomPoints } from "@geofence/profiler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.join(__dirname, "schema.proto");
const OUT_PATH = path.join(__dirname, "payload-1000.bin");

const root = await protobuf.load(PROTO_PATH);
const PointBatch = root.lookupType("PointBatch");

const pts = randomPoints(1000);
const lons = pts.map((p) => p.lon);
const lats = pts.map((p) => p.lat);

const message = PointBatch.create({ lons, lats });
const encoded = PointBatch.encode(message).finish();

fs.writeFileSync(OUT_PATH, encoded);
console.log(`Written ${encoded.length} bytes to ${OUT_PATH}`);
console.log(`  points: 1000`);
console.log(`  expected (uncompressed): ~16000 bytes`);
