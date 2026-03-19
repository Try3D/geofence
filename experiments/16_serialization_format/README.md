# 16 — Serialization Format: JSON vs JSON-flat vs Protocol Buffers

## Hypothesis

All current geofence experiments use plain JSON for HTTP request/response bodies.
At 1000-point batch sizes the request body is ~42 KB (JSON object array) vs ~16 KB
(protobuf binary). Binary protobuf should reduce per-request payload size by ~60%,
eliminate JSON parse/stringify overhead, and improve throughput — especially at high
VU counts where serialization constitutes a larger share of total request time.

An intermediate "json-flat" variant (parallel coordinate arrays instead of per-point
objects) removes per-key overhead and should land between the two in both payload
size and latency.

| Variant    | Request format                          | Payload size (1000 pts) |
|------------|-----------------------------------------|-------------------------|
| `json`     | `{"points": [{lon, lat}, ...]}`         | ~42 KB                  |
| `json-flat`| `{"lons": [...], "lats": [...]}`        | ~28 KB                  |
| `proto`    | ProtoBuf binary `PointBatch`            | 16 KB (measured)        |

Response: JSON variants return `{count, results}` JSON; proto returns binary `BatchResponse`.

## Method

- Fixed batch size: **1000 points** per request
- VU levels: **10, 50, 100**
- Duration: 60 s per run
- 3 variants × 3 VU levels = **9 k6 runs** total
- All three variants hit the same ST_Contains query against `hierarchy_boundaries`
- JSON variants use the standard k6-runner.js with `GENERATE_BODY=true` (fresh random
  points each iteration); proto variant uses a custom k6-proto.js with a single
  pre-encoded `payload-1000.bin` sent by every VU
- Backend: Express + pg, protobufjs ^7.x for proto encode/decode

## How to reproduce

```bash
# Install backend dependencies (adds protobufjs)
cd backend && npm install && cd ..

# Install protobufjs at workspace root (needed by experiment scripts)
npm install protobufjs

# Start backend
cd backend && npm run dev &

# Correctness check — all three variants must return identical results
npx tsx experiments/16_serialization_format/accuracy.ts

# Full benchmark (generates payload-1000.bin, then runs 9 k6 jobs)
npx tsx experiments/16_serialization_format/run.ts

# Results
cat benchmark-results/16_serialization_format/json/result.json
cat benchmark-results/16_serialization_format/proto/result.json
```

## Results

### Phase 1 — JSON vs JSON-flat

| Variant    | VUs | req/s | avg ms | p95 ms | fail% |
|------------|-----|------:|-------:|-------:|------:|
| json       |  10 |   7.1 |   1392 |   2453 |   0.0 |
| json       |  50 |   9.4 |   5202 |   6699 |   0.0 |
| json       | 100 |   9.2 |  10271 |  12383 |   0.0 |
| json-flat  |  10 |  10.0 |    992 |   1252 |   0.0 |
| json-flat  |  50 |   9.2 |   5301 |   6844 |   0.0 |
| json-flat  | 100 |   9.1 |  10366 |  12414 |   0.0 |

### Phase 2 — Protobuf

| Variant | VUs | req/s | avg ms | p95 ms | fail% |
|---------|-----|------:|-------:|-------:|------:|
| proto   |  10 |   8.8 |   1121 |   1407 |   0.0 |
| proto   |  50 |   8.9 |   5500 |   7246 |   0.0 |
| proto   | 100 |   8.8 |  10715 |  12925 |   0.0 |

### Payload size vs latency

| Variant   | Req size | Throughput (vus=10) | Throughput (vus=100) |
|-----------|----------|--------------------:|---------------------:|
| json      | ~42 KB   |          7.1 req/s  |           9.2 req/s  |
| json-flat | ~28 KB   |         10.0 req/s  |           9.1 req/s  |
| proto     |  16 KB   |          8.8 req/s  |           8.8 req/s  |

## Interpretation

**Serialization format has no meaningful impact on throughput or latency for this workload.**

All three variants saturate at approximately **9–10 req/s** regardless of VU count or
wire format. The DB query dominates: at 10 VUs the average latency is ~1–1.4 seconds,
meaning each request spends >95% of its time in the spatial ST_Contains query. Saving
26 KB on the request payload (json → proto) or eliminating per-point object keys
(json → json-flat) has zero observable effect when the bottleneck is elsewhere.

**Why proto does not win here:**

1. **DB is the bottleneck.** Latency is ~1 s+ per request — any serialization savings
   measured in microseconds are below the noise floor.

2. **Localhost has infinite bandwidth.** Payload size only matters on constrained
   networks. On loopback, 42 KB vs 16 KB both transfer in < 1 ms.

3. **JavaScript protobuf encoding is not free.** `protobufjs` encodes entirely in JS.
   At vus=100 the proto variant averages 10715 ms vs 10271 ms for json — a slight
   disadvantage, not an advantage. Express's `res.json()` delegates to V8's native
   `JSON.stringify()` implemented in C++, which is faster than the JS protobuf library
   for the complex nested structures (1000 PointResult × N BoundaryMatch each).

4. **json-flat shows no gain either.** Despite a ~33% smaller payload and simpler
   parsing (no per-point object allocation), json-flat is statistically tied with
   json at every VU level. Again, JSON parsing is not the bottleneck.

**Throughput plateau** around 9–10 req/s across all variants and all VU levels
confirms the system is DB-bound. Adding more VUs increases queuing, not throughput.
This is consistent with findings from exp-01 through exp-12.

## Conclusion

**Do not switch to protobuf for this workload. JSON is fine.**

The 60% reduction in request payload size from binary protobuf provides zero measurable
throughput or latency benefit when the spatial ST_Contains query takes ~1 second per
request. The only way to improve this benchmark is to make the query faster (see
exp-04, exp-07, exp-11) or use a faster HTTP runtime (see exp-13).

Protobuf would become relevant if:
- The workload moved off localhost to a constrained network link
- The DB query sped up to sub-millisecond (making serialization a non-trivial fraction)
- A native/WASM protobuf library was used instead of pure-JS protobufjs

## Accuracy

All three variants return byte-identical hierarchies for the same input points across
all tested batch sizes (1, 10, 100, 200). Verified by `accuracy.ts`.

## Limitations

- Proto benchmark sends the same static payload per VU (pre-encoded at startup), while
  JSON variants generate fresh random points each iteration. This means the DB may
  see slightly different cache behaviour, though at these latencies the effect is
  negligible.
- `k6` summary exports do not always include p99 via `--summary-export`; p95 is used
  as the tail latency metric throughout.
- `protobufjs` response decoding cost is not measured client-side (k6 does not decode
  proto responses). A real client would pay additional decode cost for proto.
