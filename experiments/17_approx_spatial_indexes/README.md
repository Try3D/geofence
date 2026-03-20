# 17 — Approximate Spatial Indexes

## Hypothesis

Point-in-polygon queries on `hierarchy_boundaries` currently use a GIST R-tree index on `bounds_4326`. Alternative index structures may reduce lookup cost:

- **SP-GiST** (space-partitioning quad-tree / k-d tree): partitions space recursively, potentially offering faster traversal for point containment in non-overlapping or lightly-overlapping geometries.
- **BRIN** (block-range index): lossy index that records geometry envelopes per disk block. After `CLUSTER` reorders rows by spatial position, sequential scans with BRIN filtering can beat R-tree traversal on large sequential reads.

## Method / Setup

- Three identical endpoints (`/exp/17/gist`, `/exp/17/spgist`, `/exp/17/brin`), each using `ST_Contains` with a different backing column and index type.
- `bounds_4326`: original GIST index (baseline from exp-12)
- `bounds_sp`: new column, SP-GiST index (`USING SPGIST`)
- `bounds_brin`: new column, BRIN index (`USING BRIN`), run after `CLUSTER` on GIST index
- Benchmark: 3 variants × 3 VU levels × 2 modes = 18 k6 runs (60s each)

### Migration

```bash
# Apply (run during low-traffic window — CLUSTER acquires ACCESS EXCLUSIVE lock)
psql postgresql://gis:gis@localhost:5432/gis -f experiments/17_approx_spatial_indexes/up.sql

# Rollback
psql postgresql://gis:gis@localhost:5432/gis -f experiments/17_approx_spatial_indexes/down.sql
```

## How to Reproduce

```bash
# 1. Apply migration
psql postgresql://gis:gis@localhost:5432/gis -f experiments/17_approx_spatial_indexes/up.sql

# 2. Start backend
cd backend && npm run dev

# 3. Verify correctness
npx tsx experiments/17_approx_spatial_indexes/accuracy.ts

# 4. Run benchmark
npx tsx experiments/17_approx_spatial_indexes/run.ts

# 5. Rollback migration
psql postgresql://gis:gis@localhost:5432/gis -f experiments/17_approx_spatial_indexes/down.sql
```

## Accuracy

All three index variants (`gist`, `spgist`, `brin`) must return identical results for identical inputs. BRIN is lossy at the index-scan level but `ST_Contains` is an exact predicate — only false-positive candidates are re-checked, so no results are dropped or added.

During development, accuracy testing revealed a latent non-determinism bug: the `ROW_NUMBER()` tie-break used only `depth DESC`, which is non-deterministic when two boundaries share the same depth (e.g. a commune at admin_level=8 and a region at admin_level=4 both at depth=0). Different index structures return candidates in different orders, exposing the bug. Fixed by extending the `ORDER BY` to `depth DESC, admin_level DESC, id` for a fully stable ordering.

```
✓ size=1:   all 1 results identical across gist/spgist/brin
✓ size=10:  all 10 results identical across gist/spgist/brin
✓ size=50:  all 50 results identical across gist/spgist/brin
✓ size=200: all 200 results identical across gist/spgist/brin
```

## Results

### Single-point mode (batchSize=1)

| Variant | VUs | Throughput (req/s) | p95 (ms) | Avg (ms) | Failures |
|---------|-----|--------------------|----------|----------|----------|
| gist    |  10 | 2,655.9            |     5.78 |     3.66 |        0 |
| gist    |  20 | 2,820.5            |    12.38 |     7.00 |        0 |
| gist    |  40 | 2,806.6            |    31.12 |    14.17 |        0 |
| spgist  |  10 | 2,521.8            |     6.13 |     3.85 |        0 |
| spgist  |  20 | 2,759.0            |    12.60 |     7.16 |        0 |
| spgist  |  40 | 2,634.4            |    34.58 |    15.10 |        0 |
| brin    |  10 |   214.4            |    74.55 |    46.46 |        0 |
| brin    |  20 |   227.2            |   156.32 |    87.81 |        0 |
| brin    |  40 |   226.4            |   310.49 |   176.35 |        0 |

### Batch-1000 mode (batchSize=1000)

| Variant | VUs | Throughput (req/s) | p95 (ms)  | Avg (ms)  | Failures |
|---------|-----|--------------------|-----------|-----------|----------|
| gist    |   5 | 4.0                |  1,377.92 |  1,248.14 |        0 |
| gist    |  10 | 4.2                |  2,645.37 |  2,380.73 |        0 |
| gist    |  20 | 4.0                |  6,453.33 |  4,883.08 |        0 |
| spgist  |   5 | 3.8                |  1,415.32 |  1,301.86 |        0 |
| spgist  |  10 | 4.2                |  2,605.97 |  2,367.62 |        0 |
| spgist  |  20 | 4.0                |  6,254.09 |  4,905.98 |        0 |
| brin    |   5 | 0.2                | 28,406.98 | 27,809.72 |        0 |
| brin    |  10 | 0.2                | 44,146.56 | 43,168.93 |        0 |
| brin    |  20 | 0.2                | 84,649.61 | 81,819.51 |        0 |

## Interpretation / Trade-offs

**GIST vs SP-GiST:** Statistically indistinguishable. SP-GiST is 5–6% slower on single-point lookups (2,522–2,759 vs 2,656–2,821 req/s) and essentially identical on batch-1000. This dataset has heavily overlapping polygon hierarchies (admin levels 4, 6, 8, 9 all nesting) — SP-GiST's space-partitioning approach provides no advantage here because overlapping polygons force it to traverse multiple branches, negating the partitioning benefit that makes SP-GiST shine for non-overlapping data.

**BRIN:** Catastrophically worse. Single-point: ~12× slower than GIST (214 vs 2,656 req/s); batch-1000: ~20× slower (0.2 vs 4.0 req/s, p95=28s vs 1.4s). BRIN was designed for sequential, correlated data (timestamps, sensor readings). Even after `CLUSTER`, random geographic queries must scan many blocks per lookup since a single block range covers a large spatial area containing unrelated polygons. The block-range false-positive rate is very high for polygon containment queries.

## Conclusion

**Use GIST (the existing index). Do not switch to SP-GiST or BRIN.**

- SP-GiST offers no meaningful gain and minor throughput regression (~5%) for hierarchical polygon data with overlapping boundaries.
- BRIN is completely unsuitable for random point-in-polygon queries, delivering 12–20× worse performance even after spatial clustering.
- The experiment did uncover a **latent non-determinism bug** in the `ROW_NUMBER()` tie-breaking order (fixed: `depth DESC, admin_level DESC, id`). This bug was hidden when using a single index type because physical row order is consistent within one index, but became visible when different index types returned candidates in different physical orders.

## Limitations / Notes

- CLUSTER acquires `ACCESS EXCLUSIVE` lock — blocks all reads during the operation.
- SP-GiST and BRIN columns are duplicates of `bounds_4326` (same data, different index) to force PostgreSQL to use the specific index type for each endpoint. This is purely experimental overhead.
- BRIN performance is highly sensitive to physical row ordering; results will vary if the table has been heavily updated since the last `CLUSTER`.
- SP-GiST would likely outperform GIST for a flat, non-overlapping polygon dataset (e.g. country boundaries only). The overhead of overlapping hierarchical boundaries is what kills the advantage.
