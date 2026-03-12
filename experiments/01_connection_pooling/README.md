# 01 — Connection Pool Size Optimisation

## Hypothesis

The API pool (pg `max`) and PgBouncer `default_pool_size` interact: too small starves
connections under load; too large wastes memory and triggers context-switch overhead.
We sweep both parameters to find the sweet spot for this workload.

## How to reproduce

Prerequisites:
- Docker running (`docker compose up -d postgres pgbouncer`)
- Backend built (`cd backend && npm install`)
- k6 installed (`brew install k6`)

```bash
# From project root
npx tsx experiments/01_connection_pooling/run.ts
```

The script cycles through 7 pool-size combinations, restarting the backend and
PgBouncer between each run, then writes results to `benchmark-results/`.

## Results

| API Pool | PG Pool | Throughput (req/s) | Avg Latency | P95 Latency | P99 Latency | Failures |
|----------|---------|--------------------|-------------|-------------|-------------|----------|
| 10       | 20      | 312.4              | 160ms       | 310ms       | 420ms       | 0.0%     |
| **15**   | **25**  | **389.1**          | **128ms**   | **248ms**   | **330ms**   | **0.0%** |
| 20       | 25      | 381.6              | 131ms       | 255ms       | 342ms       | 0.0%     |
| 25       | 25      | 376.2              | 133ms       | 260ms       | 351ms       | 0.0%     |
| 30       | 25      | 370.5              | 135ms       | 268ms       | 361ms       | 0.0%     |
| 35       | 25      | 361.8              | 138ms       | 276ms       | 372ms       | 0.0%     |
| 40       | 25      | 348.3              | 143ms       | 290ms       | 391ms       | 0.1%     |

## Conclusion

**API pool=15, PgBouncer pool=25 is optimal** for this hardware/workload.

Throughput peaks at pool=15 then gradually declines as contention for the fixed
PgBouncer pool increases. Growing the API pool beyond 15 does not help because the
DB-side pool (25) becomes the bottleneck. The backend is now configured with these
values as defaults.
