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
| [05](experiments/05_batch_algorithms/) | Batch Algorithm Comparison | **JSON expansion is 3.8% faster than temp table; 26.4% faster than serial LATERAL** |
| [06](experiments/06_spatial_tile_cache/) | Spatial Tile Cache | Negative result: tile overhead > gains for 50-100 point batches |
| [07](experiments/07_bbox_filter_optimization/) | Bbox Filter Optimization | 4.4% large-batch, 368% small-batch gains with pre-filter |
| [08](experiments/08_sql_functions/) | SQL Functions | SQL functions optimize batch queries with precompilation |
| [09](experiments/09_jit_impact/) | JIT Impact | JIT has negligible impact (<3%) on I/O-bound spatial queries |
| [10](experiments/10_minimal_payload/) | Minimal Payload | 29% latency reduction by optimizing query projection (IDs-only) |
| [11](experiments/11_hierarchy_lookup/) | Hierarchy Lookup | 97-99% speedup with precomputed hierarchy (20.9ms vs 10,533ms) |

Each experiment folder contains:
- `README.md` — hypothesis, exact reproduction steps, results table, conclusion
- `run.ts` — runnable benchmark (some also have `parity.ts`)

---

## Project layout

```
geofence/
├── experiments/          ← numbered benchmark experiments
├── tools/                ← ops/utility scripts (OSM import, DB inspection)
├── profiler/             ← @geofence/profiler library used by experiment scripts
├── backend/              ← Express API (PostGIS point-in-polygon)
│   └── src/
│       ├── server.ts     ← App setup + route registration
│       ├── db.ts         ← Connection pool
│       ├── types/        ← Shared type definitions
│       ├── utils/        ← Validators, error handling
│       ├── queries/      ← Reusable SQL query builders
│       └── routes/       ← Experiment-scoped endpoints (exp-01 through exp-11)
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
npx tsx experiments/02_batch_vs_single/run.ts
```

---

## Backend Architecture

The backend is organized into experiment-scoped routes for clarity and maintainability:

### Route Structure

```
GET  /health                    # System health check
POST /exp/01/batch              # Connection pooling experiment
GET  /exp/02/contains           # Single-point lookups
POST /exp/02/batch              # Batch lookups
POST /exp/03/batch              # Serial LATERAL (baseline)
POST /exp/03/batch-parallel     # Chunked parallelization
POST /exp/03/batch-set          # Set-join approach
POST /exp/04/batch              # Geometry simplification (supports `table` param)
POST /exp/05/batch              # Serial LATERAL (reference)
POST /exp/05/batch-json         # JSON expansion (recommended)
POST /exp/05/batch-temp         # Temp table approach
POST /exp/06/batch              # Spatial tile cache variants
POST /exp/07/batch              # Bbox pre-filter + ST_Covers
POST /exp/08/lookup             # SQL functions for batch queries
POST /exp/09/lookup             # JIT impact testing
POST /exp/10/full               # Minimal payload - full response
POST /exp/10/ids-only           # IDs only (query fetches name, response strips)
POST /exp/10/ids-optimized      # IDs optimized (query excludes name)
POST /exp/11/baseline           # Hierarchy lookup - full OSM scan baseline
POST /exp/11/normal             # Hierarchy lookup - direct hierarchy_boundaries
POST /exp/11/cte                # Hierarchy lookup - full ancestor path via CTE
POST /exp/11/cte-fallback       # Hierarchy lookup - CTE with OSM fallback
```

### Shared Utilities

- **types/** — Centralized TypeScript types (ContainsItem, BatchResult, etc.)
- **utils/** — Validation logic, error handling, async wrappers
- **queries/** — Reusable SQL query builders (no duplication across routes)

### Environment Configuration

```bash
API_BASE_URL=http://localhost:3000  # Used by experiment scripts (default)
PORT=3000                           # API server port (default)
PGHOST=localhost
PGPORT=5433
PGUSER=gis
PGPASSWORD=gis
PGDATABASE=gis
```

---

## Tools

| Script | Purpose |
|--------|---------|
| `tools/import-osm.sh` | Import a `.osm.pbf` file via osm2pgsql |
| `tools/osium.sh` | Inspect a `.osm.pbf` file with osmium |
