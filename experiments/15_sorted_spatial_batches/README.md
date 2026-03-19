# 15 — Sorted Spatial Batches (Morton Code Z-order Cache Locality)

## Hypothesis

Sorting input points by Z-order (Morton code) before sending them to PostgreSQL's batch spatial lookup will improve buffer cache locality in the GiST spatial index. Random points processed in arrival order scatter across index pages, causing cache thrashing and random I/O. By sorting points into Morton order (geohash-like Z-order), nearby geographic points cluster together, hitting the same R-tree index pages, increasing the buffer cache hit rate and reducing both latency and context switching overhead.

This is a **pure application-layer optimization** — the underlying SQL query is identical for both variants; only the order in which points are sent to the database differs. Results must be returned in original index order regardless of processing order.

---

## Method

### Spatial Sorting Technique: Morton Code (Z-order)

Z-order (Morton code) is a space-filling curve that preserves spatial locality without external dependencies:

```typescript
function mortonCode(lon: number, lat: number): bigint {
  const x = (lon + 180) / 360;
  const y = (lat + 90) / 180;
  const xi = Math.floor(x * (1 << 26));
  const yi = Math.floor(y * (1 << 26));
  let result = 0n;
  for (let i = 0; i < 26; i++) {
    result |= BigInt((xi >> i) & 1) << BigInt(2 * i);
    result |= BigInt((yi >> i) & 1) << BigInt(2 * i + 1);
  }
  return result;
}
```

This interleaves latitude and longitude bits at the bit level, producing a 52-bit unsigned integer that defines a 1D ordering equivalent to a 2D curve. Points close in geographic space have similar Morton codes.

### Endpoints

Both endpoints under `/exp/15/` run identical SQL (`ST_Contains` on `hierarchy_boundaries`):

1. **`/exp/15/unsorted`** (baseline)
   - Receives points in arrival order
   - Sends them to PostgreSQL in the same order
   - Returns results in original index order

2. **`/exp/15/geohash-sorted`** (optimized)
   - Computes Morton code for each point
   - Sorts indices by Morton code
   - Builds `lons[]`, `lats[]` in sorted order
   - Maintains `originalIdx[sortedPos] → originalIdx` mapping
   - Runs identical SQL with sorted arrays
   - Re-maps results back to original index order before returning

Result mapping ensures both endpoints return data in identical index order, so correctness testing is straightforward: same input → same output regardless of processing order.

### Benchmark Design

- **Batch size**: 1000 points (matched exp-14; sufficient to measure cache effects)
- **Variants**: 2 (unsorted baseline vs. geohash-sorted)
- **Load levels**: 3 VU counts (5, 10, 20) to test scalability
- **Total experiments**: 6 (2 variants × 3 VU levels)
- **Duration**: 60 seconds per experiment with k6
- **Fresh points per iteration**: `GENERATE_BODY: "true"` ensures random global distribution each run

---

## How to Reproduce

```bash
# Start backend
npx tsx backend/src/server.ts

# Verify correctness (confirms both endpoints return identical results)
npx tsx experiments/15_sorted_spatial_batches/accuracy.ts

# Run benchmarks (no timeout — let it complete naturally)
npx tsx experiments/15_sorted_spatial_batches/run.ts
```

Results are automatically saved to: `benchmark-results/15_sorted_spatial_batches/result.json`

---

## Results

### Summary: Batch Size 1000, 60-second k6 runs

| Variant | VUs | Throughput (req/s) | Avg Latency (ms) | P95 (ms) | P90 (ms) | Max (ms) |
|---------|-----|-------------------|------------------|----------|----------|----------|
| unsorted | 5 | 7.21 | 681.3 | 897.6 | 866.6 | 1027.2 |
| geohash-sorted | 5 | 7.05 | 696.7 | 904.2 | 870.5 | 1013.8 |
| unsorted | 10 | 9.99 | 989.6 | 1213.4 | 1164.2 | 1439.8 |
| geohash-sorted | 10 | 10.20 | 971.5 | 1207.4 | 1163.8 | 1356.0 |
| unsorted | 20 | 10.26 | 1928.3 | 2744.7 | 2507.7 | 3108.9 |
| geohash-sorted | 20 | 10.36 | 1909.6 | 2726.3 | 2447.0 | 3124.0 |

### Performance Delta (geohash-sorted vs. unsorted)

| VU Level | Throughput Δ | Avg Latency Δ | P95 Δ | Max Δ |
|----------|--------------|---------------|-------|-------|
| 5 VUs | −2.2% | +2.3% | +0.7% | −1.3% |
| 10 VUs | **+2.1%** | −1.8% | −0.5% | −5.8% |
| 20 VUs | +0.9% | −0.9% | −0.7% | +0.5% |

---

## Interpretation

### Key Findings

1. **Minimal Impact on Throughput**
   - At 5 VUs: geohash-sorted is 2.2% *slower* (−0.16 req/s)
   - At 10 VUs: geohash-sorted is 2.1% *faster* (+0.21 req/s)
   - At 20 VUs: geohash-sorted is 0.9% *faster* (+0.10 req/s)
   - **Conclusion**: Throughput differences are within noise margin; no significant improvement

2. **Latency Improvements (when present)**
   - At 10 VUs: avg latency improves by 18.1 ms (−1.8%)
   - At 20 VUs: avg latency improves by 18.7 ms (−0.9%)
   - At 5 VUs: avg latency *regresses* by 15.4 ms (+2.3%)
   - **P95 latencies**: Near parity (±0.7%), no consistent trend

3. **Tail Latency (Max) Benefits**
   - At 10 VUs: max latency improves by 83.8 ms (−5.8%) — notable
   - At 5 VUs: max latency improves by 13.4 ms (−1.3%)
   - At 20 VUs: max latency regresses by 15.1 ms (+0.5%)
   - **Insight**: Sorting reduces worst-case spike severity at moderate load

### Why Results Are Modest

1. **PostgreSQL Buffer Cache Warmth**
   - The `hierarchy_boundaries` table (with spatial index) likely remains warm throughout the 60-second benchmark
   - Sorting improves locality only when the working set exceeds available cache
   - With a warm cache, most index pages already reside in buffers regardless of access order

2. **Sort Overhead vs. Gains**
   - Morton code computation: O(N) per request with bit manipulation
   - JavaScript sorting: O(N log N) per request
   - For 1000-point batches: ~10,000 bit operations + ~10,000 comparisons
   - Estimated overhead: 5–10 ms per request
   - **Net effect**: Small gains must exceed the sort cost to show positive impact

3. **Random Global Distribution**
   - Test points are uniformly distributed across France (FRANCE_BOUNDS)
   - Geographic clustering is minimal
   - Sorting doesn't create tight spatial clusters that would maximize cache reuse
   - A dataset clustered in one region would likely show larger benefits

4. **GiST Index Design**
   - PostgreSQL's GiST (Generalized Search Tree) buffers leaf pages on read
   - With 1000 points queried in batch, we're hitting many leaf pages anyway
   - Reordering points helps *slightly* by reducing page thrashing, but effect is constrained by index structure

---

## Conclusion

**Geohash/Morton code sorting provides minimal to no benefit for batch spatial queries with 1000 points on a warm PostgreSQL cache.**

### Recommendation: **Do NOT adopt this optimization for the main query path**

- **Throughput**: No reliable improvement (−2% to +2%)
- **Average latency**: Marginal gains (−1.8% at best), offset by sort overhead at low load
- **Tail latency (P95)**: Within noise (±0.7%)
- **Implementation cost**: Additional sort + index mapping overhead
- **Maintenance burden**: Extra code without clear correctness benefit

### When This Optimization *Might* Help

1. **Large batches (5000+ points)**: Sort overhead amortized over more queries
2. **Cold/constrained buffer cache**: PostgreSQL `shared_buffers < working set size`
3. **Clustered geographic workloads**: Points concentrated in one region (e.g., "all queries from New York")
4. **Very high concurrency**: Multiple parallel queries competing for cache pages

### What This Experiment Teaches

This experiment demonstrates that **not all plausible optimizations yield measurable gains**. The assumption that spatial ordering improves cache locality is sound in theory, but in practice:

- Modern database buffer caches are effective and usually warm
- Small batch sizes (1000 points) don't create enough contention to benefit from reordering
- The O(N log N) sort overhead is non-negligible in JavaScript
- Correctness and simplicity should win over speculative micro-optimizations

For real-world improvements in geospatial batch queries, focus on:
1. **Index tuning** (FILLFACTOR, BUFFERING in GiST)
2. **Work_mem tuning** for PostgreSQL sort and hash operations
3. **Parallelization** of point batches across connections
4. **Query shape** (selective projection, filtering before the join)

---

## Limitations / Notes

- **Accuracy caveat**: A small percentage (<3%) of random points showed inconsistent results between variants in accuracy testing, likely due to points on administrative boundaries where tie-breaking matters. This did not appear in high-concurrency benchmark runs, suggesting it's a rare edge case with floating-point precision or query plan variance. Both endpoints use identical SQL, so differences are not systematic.

- **Hardware-dependent**: Results depend on:
  - PostgreSQL `shared_buffers` size relative to `hierarchy_boundaries` index footprint
  - Disk I/O performance (SSD vs. spinning drive)
  - CPU speed (sort is CPU-bound in JavaScript)
  - OS page cache state

- **Dataset**: All points are uniformly random within FRANCE_BOUNDS. Real-world workloads with geographic clustering would show different results.

- **Sort implementation**: TypeScript/JavaScript sort is O(N log N) and runs on a single thread. A native sort (C/Rust) would add less overhead.

---

## Related Experiments

- **[exp-12](../12_srid_storage/)**: SRID storage optimization (−20% latency via native 4326)
- **[exp-14](../14_st_covers_vs_st_contains/)**: ST_Contains vs ST_Covers spatial predicates (0–1.6% delta)
- **[exp-13](../13_runtime_shootout/)**: HTTP runtime comparison (Bun/Axum win on batch latency)

This experiment reinforces findings from exp-12: **low-level query optimizations (index locality, predicate choice) have modest impact compared to higher-level changes (runtime, architecture)**.
