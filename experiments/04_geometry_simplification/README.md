# 04 — Geometry Simplification

## Hypothesis

OSM polygon geometries carry far more vertices than needed for point-in-polygon
containment tests. Pre-computing simplified tables with `ST_Simplify` (tolerance
in metres) should reduce query time proportionally to vertex reduction, with
negligible loss in spatial accuracy.

## How to reproduce

Prerequisites:
- Docker running with PostGIS (`docker compose up -d postgres`)
- Simplified tables created (see migration in `db/migrations/`)
- Node.js with `pg` available (`npm install` from project root)

### Accuracy analysis (direct DB, no k6)

```bash
node experiments/04_geometry_simplification/accuracy.js
```

Generates 2 000 random test points, queries each simplification level, and
prints an IoU accuracy table.

### Throughput benchmark (k6)

```bash
node experiments/04_geometry_simplification/run.js
```

Results land in `benchmark-results/simplification/`.

## Results

### Accuracy (Monte Carlo, N=2000 points)

| Level        | Avg IoU | FP%  | FN%  | Avg verts | Reduction | Latency | Speedup  |
|--------------|---------|------|------|-----------|-----------|---------|----------|
| original     | 1.0000  | —    | —    | 312       | 0%        | 4 210ms | baseline |
| simple_10    | 0.9993  | 0.1% | 0.1% | 87        | 72%       | 1 695ms | **2.48×** |
| simple_100   | 0.9871  | 0.6% | 0.7% | 31        | 90%       | 980ms   | 4.30×    |
| simple_500   | 0.9412  | 2.8% | 2.9% | 14        | 96%       | 620ms   | 6.79×    |
| simple_1000  | 0.9041  | 5.4% | 5.3% | 9         | 97%       | 480ms   | 8.77×    |

### Throughput vs original (k6, vus=10)

| Endpoint        | Point-lookups/s | vs original |
|-----------------|-----------------|-------------|
| /batch (orig)   | 509             | 1.00×       |
| /batch-simple10 | 1 263           | 2.48×       |

## Conclusion

**`simple_10` (10 m tolerance) is the production recommendation: 2.48× speedup with
IoU=0.9993.**

At 10 m tolerance, 72% of vertices are removed while spatial accuracy is
indistinguishable from the original for all practical purposes (0.07% error rate).
Coarser tolerances trade accuracy for diminishing speed gains — `simple_100` loses
nearly 1.3% accuracy for only 1.7× additional speedup over `simple_10`.
