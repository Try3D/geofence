# 18 — Optimized Aggregate Backend

## Hypothesis

Combining all winning optimizations from experiments 01–17 into a single route will produce
cumulative performance gains greater than any individual experiment, establishing a definitive
production-grade reference implementation for geofence lookups.

## Optimizations Included

| Source | Optimization | Individual Gain |
|--------|-------------|----------------|
| Exp-11 | `hierarchy_boundaries` first-pass (40K rows vs 56M) | 4.8× single-point |
| Exp-04 | `planet_osm_polygon_simple_10` as fallback table | 2.48× |
| Exp-07 | `bounds && pt` bbox pre-filter before ST_Contains | +368% small-batch |
| Exp-14 | `ST_Contains` instead of `ST_Covers` | 0–1.59% faster |
| Exp-10 | IDs-only mode (omit `name`); `?full=true` to include names | 29% faster |
| Exp-05 | JSON-expansion (unnest + LEFT JOIN + GROUP BY ordinality) | 3.8% faster |
| Exp-03 | Promise.all chunking of fallback queries, chunk size = 100 pts | 2.48× |
| Exp-01 | Dedicated pool with `max: 15` | peak throughput |
| Exp-09 | `SET jit = off` via pool `connect` event | 4.3× on small queries |

**Excluded** (negative/neutral results): Redis cache (Exp-06), SQL functions (Exp-08),
SRID 4326 storage (Exp-12), Z-order sort (Exp-15), protobuf serialization (Exp-16),
SP-GiST/BRIN indexes (Exp-17).

## Architecture: Two-Pass Strategy

**Single-point:**
1. Query `hierarchy_boundaries` with bbox + ST_Contains → returns all matching admin boundaries ordered by depth DESC
2. If 0 rows → fallback to `planet_osm_polygon_simple_10` with bbox + ST_Contains

**Batch:**
1. Pass 1: Single query — all N points vs `hierarchy_boundaries` (LEFT JOIN + GROUP BY)
   - Rows with `matches IS NULL` → miss list
2. Pass 2: Only miss points → chunked `Promise.all` (CHUNK_SIZE=100) against `planet_osm_polygon_simple_10`

## Endpoints

- `POST /exp/18/single` — body: `{ "lon": 2.3522, "lat": 48.8566 }`
- `POST /exp/18/batch` — body: `{ "points": [{ "lon": ..., "lat": ... }, ...] }` (max 1000)
- Append `?full=true` to either endpoint to include `name` fields in response

## How to Reproduce

```bash
# Start backend
cd backend && npx tsx src/server.ts

# Smoke test single
curl -s -X POST http://localhost:3000/exp/18/single \
  -H 'Content-Type: application/json' \
  -d '{"lon":2.3522,"lat":48.8566}'

# Smoke test batch
curl -s -X POST http://localhost:3000/exp/18/batch \
  -H 'Content-Type: application/json' \
  -d '{"points":[{"lon":2.35,"lat":48.85},{"lon":5.37,"lat":43.30}]}'

# Full mode
curl -s -X POST 'http://localhost:3000/exp/18/single?full=true' \
  -H 'Content-Type: application/json' \
  -d '{"lon":2.3522,"lat":48.8566}'

# Run benchmark
npx tsx experiments/18_optimized_aggregate/run.ts
```

## Results

Baseline and optimized run head-to-head in the same benchmark (same session, fresh pgbouncer +
backend restart before each experiment — fair apples-to-apples comparison).

### Naive baseline — `POST /exp/11/baseline` (full `planet_osm_polygon` scan, 56M rows)

| Label | VUs | Batch | Req/s | Avg (ms) | p95 (ms) |
|-------|-----|-------|------:|---------:|---------:|
| baseline_single_vus=20 | 20 | 1 | 323 | 61.75 | 97.75 |
| baseline_batch1000_vus=5 | 5 | 1000 | 0.2 | 23,709 | 41,332 |

### Optimized — `POST /exp/18/single` + `/exp/18/batch` (all 9 optimizations)

| Label | VUs | Batch | Req/s | Avg (ms) | p95 (ms) |
|-------|-----|-------|------:|---------:|---------:|
| optimized_single_vus=10 | 10 | 1 | 3,536 | 2.76 | 6.01 |
| optimized_single_vus=20 | 20 | 1 | **3,835** | 5.15 | 10.54 |
| optimized_single_vus=50 | 50 | 1 | 4,371 | 11.37 | 21.12 |
| optimized_batch1000_vus=5 | 5 | 1000 | **5.7** (5,700 pt/s) | 861 | 1,360 |
| optimized_batch1000_vus=10 | 10 | 1000 | 7.5 (7,500 pt/s) | 1,318 | 1,825 |

### Cumulative speedup

| Workload | Baseline | Optimized | Speedup |
|---------|---------|---------|--------|
| Single-point (20 VUs) | 323 req/s | 3,835 req/s | **11.9×** |
| Batch-1000 (5 VUs) | 0.2 req/s | 5.7 req/s | **30×** |

## Interpretation

The hierarchy_boundaries first-pass (Exp-11) is the dominant optimization — it replaces a 56M-row
full scan with a 40K-row indexed lookup. The remaining optimizations stack on top:

- **Exp-12 (`bounds_4326`)**: eliminates per-query `ST_Transform`, matching points natively in 4326
- **Exp-07 (bbox pre-filter)**: `bounds_4326 && pt.g` drives the GIST index scan
- **Exp-04 (simple_10 fallback)**: misses fall back to the 10m-simplified table, not the raw 56M-row scan
- **Exp-03 (Promise.all chunking)**: fallback queries run in parallel chunks of 100
- **Exp-09 (JIT off)**: eliminates per-query JIT compilation overhead for small queries
- **Exp-01 (pool max=15)**: right-sized connection pool, no over-provisioning
- **Exp-10 (ids-only)**: default response omits `name` column, reducing transfer and serialization

~22% of random France-bounded points miss `hierarchy_boundaries` (sea/border areas with no admin
boundaries) and trigger the Pass 2 fallback to `planet_osm_polygon_simple_10`. This provides
complete coverage at a modest cost — the fallback table (simplified 10m geometry) is much faster
than the raw 56M-row baseline.

## Conclusion

All nine winning optimizations combine to deliver **11.9× faster single-point** and **30× faster
batch** throughput vs the naive full-scan baseline — measured head-to-head in the same session.

**Recommended production configuration:**
- Single-point: 50 VUs → 4,371 req/s at p95 = 21 ms
- Batch (1000 pts): 10 VUs → 7,500 point lookups/s at p95 = 1,825 ms per request
- Use `?full=true` only when names are required (~29% latency cost per Exp-10)

## Limitations

- Benchmark results depend on local hardware, Postgres configuration, and data distribution.
- The `hierarchy_boundaries` precomputed table must exist (created in Exp-11).
- `planet_osm_polygon_simple_10` must exist (created in Exp-04).
- Miss rate (hierarchy → fallback) varies by geographic distribution of test points;
  random global points will have a higher miss rate than points concentrated in well-mapped areas.
