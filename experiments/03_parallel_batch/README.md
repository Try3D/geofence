# 03 — Parallel Batch Strategies

## Hypothesis

The serial LATERAL query blocks one connection for the whole duration of a
1 000-point batch. Splitting the batch into smaller chunks and running them
concurrently with `Promise.all` (`/batch-parallel`) should utilise multiple
pool connections and improve throughput. A direct spatial set-join (`/batch-set`,
no LATERAL) may be even faster by avoiding per-row function overhead.

## How to reproduce

Prerequisites:
- Docker running (`docker compose up -d postgres`)
- Backend running with all three endpoints (`cd backend && npm run dev`)
- k6 installed (`brew install k6`)

```bash
# From project root
npx tsx experiments/03_parallel_batch/run.ts
```

Results land in `benchmark-results/batch-strategies/`.

## Results

| Strategy  | VUs | Point-lookups/s | P95 Latency | vs serial |
|-----------|-----|-----------------|-------------|-----------|
| serial    | 5   | 645             | 7 800ms     | 1.00×     |
| serial    | 10  | 509             | 14 200ms    | —         |
| parallel  | 5   | 1 600           | 3 100ms     | **2.48×** |
| parallel  | 10  | 1 420           | 5 800ms     | 2.21×     |
| set-join  | 5   | 1 310           | 3 700ms     | 2.03×     |
| set-join  | 10  | 1 180           | 6 300ms     | 1.84×     |

## Conclusion

**`Promise.all` chunking (`/batch-parallel`) gives 2.48× improvement over serial at
vus=5.**

Chunking into ~100-point sub-queries lets the pool serve multiple chunks in
parallel. The set-join strategy improves over serial but underperforms chunked
parallel because the planner cannot push down the LIMIT per point, leading to
larger intermediate result sets. The `/batch-parallel` endpoint is now the
recommended path for bulk batch workloads.
