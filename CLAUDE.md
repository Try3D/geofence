# CLAUDE.md — Geofence Project Notes

## TypeScript Execution

**Do NOT compile TypeScript to JavaScript.** Use `tsx` (installed as dev dependency) to run TypeScript directly:

```bash
# Run TypeScript files directly
npx tsx experiments/06_batch_algorithms/run.ts
npx tsx experiments/06_batch_algorithms/parity.ts

# Or use node with --loader if tsx is not available
node --loader ts-node/esm experiments/06_batch_algorithms/run.ts
```

Delete compiled dist directories immediately after use. Never commit `experiments_dist/`, `dist/`, or `**/dist/**` to git.

## Migrations

Run migrations using the **system `sqlx` CLI**, not Docker:

```bash
sqlx migrate run --source db/migrations --database-url postgresql://gis:gis@localhost:5432/gis
```

The `migrate` service has been removed from `docker-compose.yml`. Do not add it back.

## Project layout

```
experiments/01_connection_pooling/   ← pool-sweep profiler (run.ts)
experiments/02_batch_vs_single/      ← single vs batch throughput (run.ts)
experiments/03_parallel_batch/       ← serial/parallel/set-join (run.ts)
experiments/04_geometry_simplification/ ← simplification accuracy + k6 (accuracy.ts, run.ts)
experiments/06_batch_algorithms/     ← JSON expansion vs temp table vs serial LATERAL (run.ts, parity.ts)
tools/                               ← import-osm.sh, osium.sh, explain-batch.js, monte-carlo.js, node-worker.js
profiler/                            ← @geofence/profiler library
```

`pg` is now a root-level dependency (root `package.json`)
