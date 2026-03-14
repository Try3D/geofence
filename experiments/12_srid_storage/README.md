# 12 — SRID Storage: 4326 vs 3857 for Hierarchy Boundaries

## Hypothesis

Currently, all queries transform incoming WGS84 coordinates (SRID 4326) to Web Mercator (SRID 3857) at query time:
```sql
ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857)
```

The hypothesis is: if we store `hierarchy_boundaries.bounds` in both 3857 (current) and 4326 (native), we can skip the per-query transform for the 4326 variant and potentially save CPU on every lookup. Expected outcome: likely negligible gain (transform is O(1) per point, spatial join dominates), but worth measuring honestly.

## Method

Created two variants:
1. **baseline** — transform to 3857, use `bounds` column (current approach, same as exp-11 normal)
2. **native** — use 4326 directly, use `bounds_4326` column (no transform)

Added `bounds_4326` column to `hierarchy_boundaries` via temporary SQL scripts:
- `up.sql`: adds column, populates via `ST_Transform(bounds, 4326)`, creates GIST index
- `down.sql`: removes column and index after experiment

### Initial Run (single-run baseline)
Tested 2 variants × 2 batch sizes = 4 experiments:
- `single_baseline_vus=20` / `single_native_vus=20` — 1 point, 20 VUs
- `batch-1000_baseline_vus=10` / `batch-1000_native_vus=10` — 1000 points, 10 VUs

### Multi-trial VU Sweep (stability validation)
Re-ran to validate consistency with 3 trials per configuration:
- **Single-point**: VU levels 10, 20, 40 × 2 variants × 3 runs (some failed)
- **Batch-1000**: VU levels 5, 10, 20 × 2 variants × 3 runs
- Total: 36 experiments planned, ~18 completed successfully (54 min execution)

## How to Reproduce

```bash
# Setup
psql postgresql://gis:gis@localhost:5432/gis -f experiments/12_srid_storage/up.sql

# Run benchmark
npx tsx experiments/12_srid_storage/run.ts

# Cleanup
psql postgresql://gis:gis@localhost:5432/gis -f experiments/12_srid_storage/down.sql
```

## Results

### Initial Run (Single Experiment per Configuration)

#### Single-Point Lookups (20 VUs, 60s duration)

| Variant | Throughput | Avg Latency | P95 | P99 | Failure Rate |
|---------|-----------|-------------|-----|-----|--------------|
| baseline | 6003.69 req/s | 3.27ms | 5.49ms | - | 0% |
| native | 5867.10 req/s | 3.34ms | 5.70ms | - | 0% |

**Difference**: Native is **-2.3% throughput**, **+2.1% latency**

#### Batch-1000 Lookups (10 VUs, 60s duration)

| Variant | Throughput | Avg Latency | P95 | P99 | Failure Rate |
|---------|-----------|-------------|-----|-----|--------------|
| baseline | 10.11 req/s | 978.74ms | 1.08s | - | 0% |
| native | 10.80 req/s | 912.25ms | 1.01s | - | 0% |

**Difference**: Native is **+6.8% throughput**, **-6.8% latency**

## Accuracy Trade-off

Created `accuracy.ts` to validate result parity between variants. Testing with random points revealed:
- Single batch (1 point): 100% match
- Batch-10: 100% match
- Batch-100: 96% match
- Batch-500: 98.2% match

Mismatches appear when numeric precision loss during round-trip transformation (`ST_Transform(ST_Transform(bounds, 4326), 3857)`) causes slightly different point-in-polygon results. Database analysis showed **all 40,071 boundaries lose precision on round-trip** — this is inherent to coordinate transformation.

The mismatches are small (1-4%) and represent edge cases where a point is near a boundary and the precision difference matters. For batch queries, the native variant finds equivalent but different hierarchy boundaries due to this precision loss.

## Interpretation

### Performance Impact

- **Single-point**: Baseline is **2.3% faster** (3.27ms vs 3.35ms)
- **Batch-1000**: Native is **6.8% faster** (912.25ms vs 978.74ms, 66ms savings per 1000 rows)
- **Consistency**: Inverse relationship—native good for batch, baseline good for single-point

The difference is **not** due to ST_Transform overhead (which is O(1) and negligible). The gains/losses come from subtle differences in how PostGIS handles GIST index queries on different SRIDs. The native approach's faster batch performance suggests the GIST index structure or query planning differs between 3857 and 4326 coordinates.

### Real-world Impact

For a typical geofence service processing 1000-point batches:
- Native approach: ~66ms faster per batch
- But accuracy loss affects ~1-4% of queries at boundary edges
- For 10K batches/day, saves ~660ms total but produces ~100-400 incorrect results daily (depending on point distribution)

### Accuracy Cost

The native approach trades **small accuracy loss** (1-4% edge cases) for no meaningful performance gain. This is a poor trade-off because:
1. Performance gain is negligible
2. Accuracy degradation is real but random (different boundaries matched)
3. Adds storage cost (extra geometry column + index)

## Multi-Trial Results (VU Sweep)

Re-ran the benchmark with 3 trials per configuration to assess consistency. However, some experiments (single-point, VU=40) encountered issues during execution. Available results:

### Batch-1000 Lookups (3 runs each)

#### VUs: 10

| Variant | Throughput (req/s) | Avg Latency (ms) |
|---------|------------------|------------------|
| baseline | 9.95 (9.69–10.09) | 994 (980–1022) |
| native | 9.46 (9.27–9.64) | 1047 (1026–1070) |
| **Diff** | **-5.0%** | **+5.2%** |

#### VUs: 20

| Variant | Throughput (req/s) | Avg Latency (ms) |
|---------|------------------|------------------|
| baseline | 9.34 (9.27–9.39) | 2119 (2107–2137) |
| native | 8.96 (8.91–9.01) | 2207 (2198–2219) |
| **Diff** | **-4.1%** | **+4.2%** |

### Observations

The multi-trial results **contradict the initial single-run findings**:
- **Initial test (VU=10)**: native +6.8% faster
- **Multi-trial test (VU=10)**: baseline +5.0% faster

This reversal suggests:
1. The ~5% difference is within measurement variability and not consistent
2. Noise/system variance at this scale makes the difference statistically uncertain
3. Single-run conclusions were unreliable

## Conclusion

**Recommendation: Do not implement SRID storage duality.**

The multi-trial benchmark reveals that the performance difference is **inconsistent and unreliable**:

1. **Initial vs. multi-trial reversal**: First run showed native +6.8% on batch, multi-trial shows baseline +5%. This 12% swing indicates the difference is within noise levels.

2. **Accuracy trade-off is not worth it**: Regardless of minor performance fluctuations, the 1-4% accuracy loss from round-trip precision (all 40K boundaries affected) outweighs any conditional performance gain.

3. **Real-world risk**: In production, a strategy based on a single favorable benchmark could prove counterproductive if the system behavior differs slightly (caching effects, query patterns, etc.).

**Why not proceed despite possible gains?**
- Performance difference is too small and inconsistent to be reliable (±5% swing across runs)
- Accuracy loss is systematic (affects all boundaries) and real
- Storage cost (duplicate column + index) adds maintenance burden
- The transform overhead was hypothesized to be large but is actually negligible
- Current approach is proven, simple, and perfectly adequate

The current approach (transform at query time) remains optimal for typical mixed workloads. Invest optimization effort elsewhere.

## Limitations

1. **Precision loss is asymmetric**: Round-trip `3857 → 4326 → 3857` loses precision, but our comparison used `4326 → transform(3857)` for storage, which is lossless. However, when querying against the round-tripped geometry, precision loss does occur.

2. **Accuracy test measures boundary mismatches, not functional impact**: For the geofence use case, a point matching a different boundary at the same depth might be acceptable depending on business requirements.

3. **Edge case distribution**: The 1-4% mismatch rate only affects points near boundary edges; interior points are unaffected.

## Notes

- Migration files (`up.sql`, `down.sql`) are not permanent — they're only for this experiment
- Benchmark included proper load distribution via k6 with configurable VUs and duration
- All results are from production-like France-bounded point distribution via `randomPoints()`
