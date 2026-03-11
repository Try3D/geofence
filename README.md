# Geofence

Point-in-polygon lookups over OSM data, served via a Node.js/PostGIS API.
This repo contains the API, database migrations, and a series of benchmarking
experiments that drove the production configuration.

---

## Experiments

| # | Experiment | Key finding |
|---|-----------|-------------|
| [01](experiments/01_connection_pooling/) | Connection Pooling | API pool=15, PgBouncer=25 is optimal |
| [02](experiments/02_batch_vs_single/) | Batch vs Single | Single-point parallelises better (902 pts/s vs 645) |
| [03](experiments/03_parallel_batch/) | Parallel Batch | Promise.all chunking: 2.48× over serial at vus=5 |
| [04](experiments/04_geometry_simplification/) | Geometry Simplification | simple_10 (10 m): 2.48× speedup, IoU=0.9993 |

Each experiment folder contains:
- `README.md` — hypothesis, exact reproduction steps, results table, conclusion
- `run.js` — runnable benchmark (some also have `accuracy.js`)

---

## Project layout

```
geofence/
├── experiments/          ← numbered benchmark experiments
├── tools/                ← ops/utility scripts (OSM import, DB inspection)
├── profiler/             ← @geofence/profiler library used by experiment scripts
├── backend/              ← Express API (PostGIS point-in-polygon)
├── db/                   ← sqlx migrations
├── docker/               ← Dockerfiles
├── docker-compose.yml
└── benchmark-results/    ← gitignored; results written here at runtime
```

---

## Quick start

```bash
# 1. Start infrastructure
docker compose up -d postgres pgbouncer

# 2. Run migrations
sqlx migrate run --source db/migrations \
  --database-url postgresql://gis:gis@localhost:5432/gis

# 3. Import OSM data
./tools/import-osm.sh path/to/region.osm.pbf

# 4. Start API
cd backend && npm install && npm run dev

# 5. Run an experiment
node experiments/02_batch_vs_single/run.js
```

---

## Tools

| Script | Purpose |
|--------|---------|
| `tools/import-osm.sh` | Import a `.osm.pbf` file via osm2pgsql |
| `tools/osium.sh` | Inspect a `.osm.pbf` file with osmium |
