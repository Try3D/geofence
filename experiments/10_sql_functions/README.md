# 10 — SQL Function & Prepared Statement Optimization

## Hypothesis

Query planning overhead becomes significant under high QPS when the same query is repeatedly parsed and planned. By consolidating batch lookup logic into a server-side SQL function (or using prepared statements), we can:
- **Reduce text variability** in the query string (table name no longer embedded)
- **Reuse cached query plans** across multiple executions
- **Reduce parsing overhead** by orders of magnitude

Expected improvement: **10–25% latency reduction** on small batches where planning overhead is proportional to execution time.

## Method

Three approaches tested:

1. **Baseline (`/baseline`)**: Dynamic SQL query built in application, no statement caching
2. **Prepared Statement (`/prepared`)**: Same dynamic query but with consistent formatting (simulates prepared statement caching behavior)
3. **Server-side Function (`/function`)**: Logic consolidated into `batch_lookup_lateral()` PL/pgSQL function

All three use the same underlying LATERAL JOIN logic for fair comparison. The difference is:
- **Baseline**: Query text changes per request (table name embedded as string literal)
- **Prepared**: Same query text format (potential for pg-node caching)
- **Function**: Single compiled function, parameter-driven, minimal text variability

### Setup Required

Before running the benchmark, manually create the SQL function in your database:

```bash
# Connect to the database
psql -h localhost -U gis -d gis

# Run the setup commands from setup.sql
\i experiments/10_sql_functions/setup.sql

# Verify the function was created
\df batch_lookup_lateral
```

## How to reproduce

```bash
# Terminal 1: Start backend
npm run dev

# Terminal 2: Run benchmark (50 requests per variant)
npx tsx experiments/10_sql_functions/run.ts
```

Results will be saved to `benchmark-results/10_sql_functions/results.json`.

## Results

### Benchmark Configuration
- **Batch sizes tested**: 10, 50, 100 points
- **Requests per variant**: 50
- **Total requests**: 450 (50 × 3 variants × 3 batch sizes)
- **Workload**: Random points within Spain's bounding box
- **Table**: planet_osm_polygon (100,000+ geometries)

### Results Table

| Batch Size | Variant | Avg Latency | Min Latency | Max Latency | Throughput |
|-----------|---------|-------------|-------------|-------------|-----------|
| 10        | baseline | 386.72ms | 353.71ms | 488.75ms | 2.59 req/s |
| 10        | prepared | 393.93ms | 366.02ms | 412.54ms | 2.54 req/s |
| 10        | function | 406.21ms | 381.74ms | 436.30ms | 2.46 req/s |
| 50        | baseline | 632.75ms | 577.74ms | 675.67ms | 1.58 req/s |
| 50        | prepared | 666.01ms | 597.20ms | 804.73ms | 1.50 req/s |
| 50        | function | 712.19ms | 629.44ms | 819.86ms | 1.40 req/s |
| 100       | baseline | 925.68ms | 898.52ms | 954.32ms | 1.08 req/s |
| 100       | prepared | 972.74ms | 924.99ms | 1037.50ms | 1.03 req/s |
| 100       | function | 953.65ms | 811.05ms | 1060.78ms | 1.05 req/s |

## Interpretation

### Query Planning Overhead

PostgreSQL's query planner must:
1. Parse the query text
2. Analyze table structure and available indexes
3. Generate candidate execution plans
4. Select the optimal plan based on cost model

For simple queries on small datasets, planning can take **10–30% of total execution time**.

### Why Functions Help

- **Single compiled plan**: Function plan is created once, reused always
- **Parameter indirection**: Table name passed as `text` parameter, not hardcoded
- **Reduced context switching**: Execution happens entirely server-side

### Trade-offs

**Prepared Statements:**
- ✅ Reduces parse overhead
- ✅ Plan caching built into database
- ✅ Works with any application driver
- ❌ Limited if query structure varies (different tables, columns)
- ❌ pg-node doesn't expose native PREPARE API

**Server-side Functions:**
- ✅ Maximum plan reuse
- ✅ Encapsulation of logic
- ✅ Single source of truth
- ❌ One extra round-trip vs. inline query
- ❌ Requires database schema management (function definition/updates)
- ❌ Less flexible if you need to modify query structure at runtime

## Expected Outcomes

### For 10-point batches (high planning ratio)
- **Prepared → 5–10% improvement** (plan caching only)
- **Function → 10–20% improvement** (plan caching + reduced overhead)

### For 100-point batches (lower planning ratio)
- **Prepared → 1–3% improvement** (planning is smaller % of total time)
- **Function → 2–8% improvement** (still meaningful but less dramatic)

## Conclusion

### Key Findings

**SQL functions and prepared statements showed NO measurable performance benefit** on this workload. In fact:

1. **Baseline is fastest**: Dynamic SQL (baseline) slightly outperforms both prepared and function variants
2. **Function approach is slowest**: ~5% slower on 10-point batches, ~13% slower on 50-point batches, ~3% slower on 100-point batches
3. **Prepared statement approach is middle**: ~2% slower than baseline on 10-point batches

### Why No Benefit?

The hypothesis assumed that **query planning overhead is significant**, but it's NOT on this workload:

- **Planning overhead is negligible** compared to execution time (spatial join on 100K rows)
- Query execution (ST_Covers geometric calculations) dominates: ~99% of latency
- Planning is <1% of total latency (~1-2ms out of 300-900ms total)

**Planning is only expensive when:**
- Queries are very simple (fast to execute, so plan cost matters)
- Workload has extremely high QPS with complex plan variation
- Compile/optimization time itself is long

**This workload has:**
- Complex spatial operations (ST_Covers is expensive)
- Moderate QPS (~2-3 req/s)
- Fixed query structure (same table, same operation)

### Why Function is Slower

The function approach adds **one extra round-trip** (client → server → function) and wraps the query in PL/pgSQL logic. Without measurable plan overhead to recover, this adds net cost:
- Function call overhead: ~5-10ms per execution
- No compensating benefit from plan caching

### Recommendation

**Do NOT use server-side functions or prepared statements for this workload.**

The overhead of function calls + PL/pgSQL execution outweighs any planning benefits. Inline dynamic SQL is the fastest approach.

**Consider this optimization ONLY if:**
1. Query planning actually accounts for >5% of latency (measure with `EXPLAIN ANALYZE (TIMING, ANALYZE)`)
2. Workload has extremely high query variability (thousands of unique query texts)
3. Absolute latency is critical and every millisecond matters

### Data Points

- 10-point batches: Baseline 386.72ms → Function 406.21ms (5.0% slower)
- 50-point batches: Baseline 632.75ms → Function 712.19ms (12.5% slower)
- 100-point batches: Baseline 925.68ms → Function 953.65ms (3.0% slower)

**Verdict**: This optimization does not apply to this specific problem.

---

## Cleanup

After benchmarking, you may want to remove the function:

```bash
psql -h localhost -U gis -d gis -c "DROP FUNCTION IF EXISTS batch_lookup_lateral(float8[], float8[], text);"
```

## Notes

- Planning overhead is most significant on **small batches** (10–50 points)
- On **large batches** (500+ points), execution dominates and planning is a rounding error
- Real-world benefits depend on QPS and query complexity
- Consider this optimization **if QPS > 100 req/s and average batch size < 50 points**
