# Experiment 06: Batch Algorithm Comparison

Compares three batch processing strategies for the geofence API:

1. **JSON Expansion** (`/api/polygons/batch-json`): Set-based spatial join with JSON array unnesting and aggregation per point
2. **Temp Table** (`/api/polygons/batch-temp`): Session-local temporary table with spatial join and aggregation
3. **Serial LATERAL** (`/api/polygons/batch`): Baseline approach using LATERAL subqueries (existing implementation)

## Benchmark Matrix

- **Batch sizes**: 100, 1000 points
- **Concurrency (VUs)**: 5, 10, 20
- **Tables**: `planet_osm_polygon` (original), `planet_osm_polygon_simple_10` (simplified)
- **Total experiments**: ~32 runs

## Metrics

- `point-lookups/s` — primary metric (request throughput × batch size)
- `req/s` — secondary metric (request throughput)
- p50, p95, p99 latency
- Failure rate

## Output Format

All methods return identical structure:
```json
[
  { "idx": 0, "matches": [{"osm_id": "...", "name": "..."}, ...] },
  { "idx": 1, "matches": [] },
  ...
]
```

Points with zero matches are included as empty arrays for consistency.

## Running

### Compile
```bash
npm run build --workspace profiler
npx tsc --outDir experiments_dist experiments/06_batch_algorithms/*.ts --esModuleInterop --skipLibCheck
```

### Run full benchmark
```bash
node experiments_dist/06_batch_algorithms/run.js
```

### Run parity checker first (optional)
```bash
node experiments_dist/06_batch_algorithms/parity.js
```

Results are saved to `benchmark-results/06_batch_algorithms/`.

## Expected Outcomes

- **JSON expansion** should perform well for small-medium batches (simpler query shape, low memory overhead)
- **Temp table** should excel at larger batches/high concurrency (dedicated index, single round-trip)
- **Serial LATERAL** should be slowest (sequential point processing)

Recommendation will depend on workload: offline/bulk scenarios may favor temp table, while interactive APIs may prefer JSON expansion.
