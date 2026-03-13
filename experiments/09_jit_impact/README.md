# 09 — JIT Impact on Query Performance

## Hypothesis

Just-In-Time (JIT) compilation may hurt latency on small, frequently-executed queries because the fixed compilation overhead (~5–15ms) outweighs benefits for short-running queries. For batch lookups with 10–100 points, JIT overhead may be a net cost.

Expected impact:
- **Small batches (10–50 points):** JIT OFF is 3–8% faster
- **Large batches (500+ points):** JIT ON may be 2–5% faster
- **Null hypothesis:** JIT impact is negligible (<3%) because workload is I/O-bound, not CPU-bound

## Method

Automated two-phase load testing with k6, toggling JIT between each run:

1. Run 60s k6 benchmark with 10 VUs at batch sizes 10, 50, 100 **with JIT OFF**
2. Run identical benchmarks **with JIT ON**
3. Compare throughput, latency (p95/p99), and failure rates

JIT toggling via automated `/exp/09/toggle-jit` endpoint (requires PostgreSQL superuser).

## How to reproduce

```bash
# Terminal 1: Start backend (must run as superuser-enabled PostgreSQL)
npm run dev

# Terminal 2: Run full benchmark (auto-toggles JIT between experiments)
npx tsx experiments/09_jit_impact/run.ts
```

Results saved to `benchmark-results/09_jit_impact/result.json` with full k6 metrics.

## Results

### Benchmark Configuration
- **Batch sizes**: 10, 50, 100 points
- **Duration per variant**: 60 seconds
- **Virtual users (VUs)**: 10
- **JIT variants**: OFF and ON (6 experiments total)
- **Load test framework**: k6 with automated JIT toggling
- **Query endpoint**: POST `/exp/09/lookup` (planet_osm_polygon lookup)

### k6 Metrics Captured
- **Throughput** (req/s): Requests per second
- **P95 Latency** (ms): 95th percentile latency
- **P99 Latency** (ms): 99th percentile latency
- **Avg Latency** (ms): Mean latency across all requests
- **Failure Rate**: % of failed requests (threshold: <5%)

### Results

| Batch Size | JIT State | Throughput (req/s) | Avg Latency (ms) | P95 Latency (ms) | Improvement |
|---|---|---|---|---|---|
| **10** | OFF | 70.15 | 142.23 | 161.70 | — |
| **10** | ON | 16.41 | 607.58 | 654.19 | **-76.6%** (JIT slower) |
| **50** | OFF | 14.63 | 680.96 | 730.70 | — |
| **50** | ON | 8.69 | 1146.27 | 1296.38 | **-40.6%** (JIT slower) |
| **100** | OFF | 7.04 | 1416.13 | 1539.97 | — |
| **100** | ON | 5.39 | 1835.30 | 1963.44 | **-23.4%** (JIT slower) |

## Interpretation

### Key Finding: JIT Makes Queries SLOWER

**Contrary to the hypothesis, JIT is a net performance cost on this workload:**

- **Batch 10**: JIT OFF is **4.3× faster** (70.15 vs 16.41 req/s)
- **Batch 50**: JIT OFF is **1.7× faster** (14.63 vs 8.69 req/s)
- **Batch 100**: JIT OFF is **1.3× faster** (7.04 vs 5.39 req/s)

### Why JIT Hurts This Workload

1. **JIT compilation overhead is significant (~400–500ms)**
   - Even though overhead should be amortized, results show per-query penalty
   - Hypothesis predicted overhead would be ~5–15ms; actual impact is 400–500ms per query
   - May indicate: JIT being triggered on EVERY query, not cached compilations

2. **I/O-bound, not CPU-bound**
   - ST_Covers (PostGIS C code) already optimized
   - Bottleneck is disk I/O for 100K polygon scan
   - JIT cannot optimize I/O operations
   - CPU time savings are microscopic compared to I/O time

3. **Query plan compiled repeatedly**
   - May indicate plan cache is not working as expected
   - Or JIT compilation threshold (`jit_above_cost` = 100,000) is set too low
   - Each request incurs full JIT cost with no amortization

4. **No complex expressions to optimize**
   - Query is: `LATERAL JOIN + ST_Covers(...)`
   - No tight loops, complex PL/pgSQL, or expensive expression evaluation
   - JIT is designed for these; this workload has none

### Recommendation

**DISABLE JIT globally: `ALTER SYSTEM SET jit = off;`**

JIT provides no benefit and adds substantial overhead. The compilation cost far outweighs any CPU optimizations.

**Optimization priorities** (by impact):
1. **Bounding box filters** (exp-07): +4.4% to +368% depending on batch size
2. **Batch algorithms** (exp-05): 3.8% optimization on JSON expansion
3. **Connection pooling** (exp-01): steady-state throughput improvement
4. **JIT: DISABLE** (this experiment): -23% to -76% penalty

## Technical Details

### PostgreSQL JIT Configuration

- `jit` — Enable/disable JIT (on | off)
- `jit_above_cost` — Query cost threshold for JIT compilation (default: 100,000)
- `jit_inline_above_cost` — Threshold for inlining (default: 500,000)
- `jit_above_cost` may be set too low, causing expensive compilation on every query

### Automated Toggling

The benchmark uses `/exp/09/toggle-jit` backend endpoint to automatically toggle JIT before each experiment via:
```sql
ALTER SYSTEM SET jit = on/off;
SELECT pg_reload_conf();
```

This ensures clean before/after measurement without manual intervention.

## Limitations & Notes

1. **Superuser required**: `ALTER SYSTEM` needs PostgreSQL superuser permissions
2. **Fresh config reload**: Config is reloaded system-wide; active connections persist old config for ~1s
3. **PostgreSQL version**: Results depend on JIT implementation (v11+ differs across versions)
4. **Plan cache state**: Connection pooling can affect plan reuse; here we restart backend between tests for isolation
5. **Unexpected overhead**: JIT showing significant (400–500ms) per-query cost suggests either:
   - Query is being recompiled on every request (plan cache miss?)
   - JIT threshold is misconfigured for this workload
   - Database version or configuration has suboptimal JIT settings
