# CLAUDE.md — Geofence Project Notes

## Migrations

Run migrations using the **system `sqlx` CLI**, not Docker:

```bash
sqlx migrate run --source db/migrations --database-url postgresql://gis:gis@localhost:5432/gis
```

The `migrate` service has been removed from `docker-compose.yml`. Do not add it back.

## Project layout

```
experiments/01_connection_pooling/   ← pool-sweep profiler (run.js)
experiments/02_batch_vs_single/      ← single vs batch throughput (run.js)
experiments/03_parallel_batch/       ← serial/parallel/set-join (run.js)
experiments/04_geometry_simplification/ ← simplification accuracy + k6 (accuracy.js, run.js)
tools/                               ← import-osm.sh, osium.sh, explain-batch.js, monte-carlo.js, node-worker.js
profiler/                            ← @geofence/profiler library
```

The old `scripts/`, `k6/`, and `docs/` directories have been removed.
`pg` is now a root-level dependency (root `package.json`) — no separate `scripts/package.json`.
