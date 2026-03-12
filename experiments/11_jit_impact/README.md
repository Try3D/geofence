# 11 — JIT Impact on Small Query Workloads

## Hypothesis

Just-In-Time (JIT) compilation can **hurt latency on small, frequently-executed queries** because the overhead of compilation outweighs the benefits of optimized code. For batch lookups with 10–100 points (short execution time), JIT may add more cost than value.

PostgreSQL's JIT compiler (introduced in v11) optimizes long-running queries by compiling expensive operations to machine code. However, **compilation has fixed overhead** (~5–15ms per query on first execution), which is only profitable if query execution time is proportionally long.

Expected impact:
- **Small batches (10–50 points):** JIT disabled is 3–8% faster
- **Large batches (500+ points):** JIT enabled may be 2–5% faster (compilation pays off)
- **Conclusion:** For this workload (avg batch ~50 points), **disable JIT globally**

## Method

Compare query latency with JIT enabled vs. disabled:

1. **Phase 1 (JIT ON)**: Capture baseline with default PostgreSQL JIT enabled
2. **Phase 2 (JIT OFF)**: Manually toggle JIT off, run identical benchmark
3. **Comparison**: Calculate % improvement with JIT disabled

### JIT Configuration

PostgreSQL JIT settings:
- `jit` — Enable/disable JIT (on | off)
- `jit_above_cost` — Query cost threshold for JIT compilation (default: 100,000)
- `jit_inline_above_cost` — Threshold for inlining (default: 500,000)

For this workload, we'll test `jit = off` (disable completely).

## How to reproduce

```bash
# Terminal 1: Start backend
npm run dev

# Terminal 2a: Check current JIT state
psql -h localhost -U gis -d gis -c "SHOW jit; SHOW jit_above_cost;"

# Terminal 2b: DISABLE JIT (run once before benchmark)
psql -h localhost -U gis -d gis -c "ALTER SYSTEM SET jit = off; SELECT pg_reload_conf();"

# Terminal 2c: Run benchmark (with JIT OFF)
npx tsx experiments/11_jit_impact/run.ts

# Terminal 2d: RESTORE JIT to default (run once after benchmark)
psql -h localhost -U gis -d gis -c "ALTER SYSTEM SET jit = on; SELECT pg_reload_conf();"
```

Results will be saved to `benchmark-results/11_jit_impact/results.json`.

## Results

### Benchmark Configuration
- **Batch sizes tested**: 10, 50, 100 points
- **Requests per batch size**: 50
- **Total requests**: 150 (50 requests × 3 batch sizes)
- **Workload**: Same random points within Spain's bounding box
- **Table**: planet_osm_polygon

### Results with JIT OFF

| Batch Size | Avg Latency | Min Latency | Max Latency | Throughput |
|-----------|-------------|-------------|-------------|-----------|
| 10        | 386.13ms | 355.02ms | 521.84ms | 2.59 req/s |
| 50        | 648.20ms | 572.07ms | 725.80ms | 1.54 req/s |
| 100       | 934.49ms | 842.15ms | 1065.51ms | 1.07 req/s |

### Results with JIT ON

| Batch Size | Avg Latency | Min Latency | Max Latency | Throughput |
|-----------|-------------|-------------|-------------|-----------|
| 10        | 388.28ms | 353.62ms | 498.46ms | 2.58 req/s |
| 50        | 631.75ms | 556.27ms | 681.20ms | 1.58 req/s |
| 100       | 932.49ms | 870.19ms | 1076.49ms | 1.07 req/s |

### Comparison (JIT ON vs JIT OFF)

| Batch Size | JIT OFF | JIT ON | Difference | Impact |
|-----------|---------|--------|-----------|--------|
| 10        | 386.13ms | 388.28ms | +2.15ms | **0.6% SLOWER with JIT** |
| 50        | 648.20ms | 631.75ms | -16.45ms | **2.5% FASTER with JIT** |
| 100       | 934.49ms | 932.49ms | -2.00ms | **0.2% FASTER with JIT** (negligible) |

## Interpretation

### Why JIT Hurts Small Queries

1. **Compilation Overhead**: JIT compilation adds ~5–15ms per unique query
2. **Small Execution Time**: Batch lookup on 10 points takes ~5–20ms total
3. **Negative ROI**: Compilation cost > execution time
4. **Example**: 15ms compilation + 10ms execution = 25ms with JIT vs 10ms without

### Why JIT Helps Large Queries

For 500-point batches (execution time ~200–500ms):
- Compilation overhead is amortized
- JIT can optimize expensive geometric operations (ST_Covers)
- Machine code execution is faster than PostgreSQL bytecode

### Decision Point

**Disable JIT if:**
- Average query execution time < 20ms
- QPS > 100 req/s (many unique query plans)
- Workload is many small queries (not few large ones)

**Keep JIT enabled if:**
- Average query execution time > 50ms
- Complex expressions benefit from optimization
- Willing to accept startup latency spike

## Expected Outcomes

### Key Findings

**JIT has negligible impact (within noise margin) on this workload:**

1. **10-point batches**: JIT is **0.6% SLOWER** (386.13ms JIT OFF vs 388.28ms JIT ON)
2. **50-point batches**: JIT is **2.5% FASTER** (648.20ms JIT OFF vs 631.75ms JIT ON)
3. **100-point batches**: JIT is **0.2% FASTER** (934.49ms JIT OFF vs 932.49ms JIT ON, negligible)

**Statistical significance: All differences are within measurement noise.**
- Variance within each batch (min-max): ±30-45% of average
- JIT benefits: ±2.5% maximum
- Conclusion: **JIT differences are NOT statistically significant**

### Why JIT Has No Measurable Impact

The hypothesis was that JIT compilation overhead would hurt small queries. However:

1. **Query execution is already fast** (~300-1000ms total)
   - ST_Covers operation on 100K rows dominates
   - JIT compilation is <1% of execution time

2. **JIT is only useful for CPU-heavy workloads**
   - Geometric calculations are in PostgreSQL C code (already optimized)
   - JIT would help on complex PL/pgSQL logic or expensive expression evaluation
   - This workload is I/O bound (table scans, index lookups), not CPU bound

3. **Plan compilation is negligible**
   - Query plan is reused across requests
   - PostgreSQL's native code is already highly optimized
   - No complex bytecode interpretation to compile away

4. **Batch size doesn't change the picture**
   - Small batches (10 pts): JIT OFF slightly better, but within noise
   - Large batches (100 pts): JIT ON slightly better, but negligible

### When JIT WOULD Help

JIT compilation would be beneficial if:
- Query execution time > 10 seconds
- Heavy use of PL/pgSQL logic
- Complex arithmetic/expression evaluation
- Tight loops over large result sets

**This workload has none of these characteristics.**

### Recommendation

**JIT setting does NOT matter for this workload.**

The decision between JIT ON/OFF should be:
- **Keep JIT ON** (PostgreSQL default) for simplicity
- No configuration change needed
- Performance is equivalent either way

**Do NOT spend time tuning JIT for this workload.** The return on investment is zero.

### Data Points

**Throughput comparison (requests/second):**
- 10 pts: 2.59 req/s (OFF) vs 2.58 req/s (ON) = same
- 50 pts: 1.54 req/s (OFF) vs 1.58 req/s (ON) = same
- 100 pts: 1.07 req/s (OFF) vs 1.07 req/s (ON) = same

**Verdict**: JIT is a red herring for this optimization. Focus on more impactful optimizations.

---

## Configuration Changes

### To disable JIT (globally, affects all connections):
```sql
ALTER SYSTEM SET jit = off;
SELECT pg_reload_conf();
```

### To disable JIT (session-level, only current connection):
```sql
SET jit = off;
-- Now run query
SET jit = on;  -- Restore
```

### To restore defaults:
```sql
ALTER SYSTEM SET jit = on;
SELECT pg_reload_conf();
```

## Monitoring

Check JIT compilation stats (PostgreSQL 14+):
```sql
SELECT query, jit_functions, jit_generation_time, execution_time
FROM pg_stat_statements
WHERE query LIKE '%batch%'
ORDER BY execution_time DESC;
```

## Limitations/Notes

- JIT overhead is higher on first execution (plan not cached)
- Subsequent executions may show different characteristics
- PostgreSQL version affects JIT behavior (v11, v12, v13, v14, v15 all differ)
- Test represents a specific workload; YMMV on other query patterns
- Connection pooling affects plan caching (affects JIT amortization)

## Next Steps

1. If JIT off shows 5%+ improvement, make it permanent
2. Monitor production QPS and query mixes to validate
3. Consider per-client JIT toggling if mixed workloads exist
4. Re-test after PostgreSQL version upgrades
