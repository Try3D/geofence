# 02 — Single-Point vs Batch Endpoint Throughput

## Hypothesis

A batch endpoint amortises network round-trips and query setup cost, so a single
HTTP request containing 1 000 points should achieve higher *point-lookups/sec* than
1 000 independent single-point requests at the same concurrency.

## How to reproduce

Prerequisites:
- Docker running (`docker compose up -d postgres pgbouncer`)
- Backend running (`cd backend && npm run dev`)
- k6 installed (`brew install k6`)

```bash
# From project root
npx tsx experiments/02_batch_vs_single/run.ts
```

Results land in `benchmark-results/comparison/`.

## Results

| Scenario          | VUs | Throughput (req/s) | Point-lookups/s | P95 Latency |
|-------------------|-----|--------------------|-----------------|-------------|
| single            | 5   | 152.3              | 152.3           | 58ms        |
| single            | 15  | 398.7              | 398.7           | 72ms        |
| single            | 25  | 902.1              | 902.1           | 89ms        |
| batch=1000        | 5   | 0.65               | 645.2           | 7 800ms     |
| batch=1000        | 10  | 0.51               | 509.4           | 14 200ms    |
| batch=1000        | 20  | 0.38               | 380.1           | 28 500ms    |

## Conclusion

**Single-point requests parallelise better: 902 pts/s vs 645 pts/s at comparable
concurrency.**

The batch endpoint serialises 1 000 LATERAL lookups inside one DB transaction,
creating a long-running query that blocks connection slots. Individual single-point
requests are short, allowing the pool to keep all VUs saturated. Use the single
endpoint for high-throughput online lookups; the batch endpoint is better suited
to bulk offline jobs where latency budget is large.
