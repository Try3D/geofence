# Geofence Experiment Report (Temporary)

This report summarizes the approach and outcome of each experiment in this repo.

## Executive Snapshot

| Experiment | Approach Tested | Key Result | Recommendation |
|---|---|---|---|
| 01 — Connection Pooling | Sweep API pool (`pg max`) vs PgBouncer pool | Best at API=15, PgBouncer=25 | Keep backend pool 15, PgBouncer 25 |
| 02 — Batch vs Single | Compare single-point requests vs 1000-point batch | Single-point parallelizes better (902 pts/s vs 645) | Use single-point endpoint for online high-throughput lookups |
| 03 — Parallel Batch | Compare serial LATERAL vs chunked parallel vs set-join | Chunked `Promise.all` is 2.48x faster than serial (vus=5) | Use `/exp/03/batch-parallel` for bulk batch workloads |
| 04 — Geometry Simplification | Compare original geometry vs simplified tables | `simple_10` gives 2.48x speedup with IoU=0.9993 | Use `planet_osm_polygon_simple_10` in production paths |
| 05 — Batch Algorithms | Compare serial LATERAL vs JSON expansion vs temp table | JSON expansion is ~3.8% faster than temp and ~26.4% faster than serial (at VU=10), parity passed | Use `/exp/05/batch-json` |

---

## 01 — Connection Pool Size Optimization

**Approach**
- Swept multiple pool-size combinations between API process pool and PgBouncer.
- Measured throughput and tail latencies under load.

**What was tested**
- API pool sizes roughly 10 to 40.
- PgBouncer target around 20 to 25.

**Result**
- Best operating point was **API pool=15, PgBouncer pool=25**.
- Larger API pools did not improve throughput once DB-side pooling became the bottleneck.

**Takeaway**
- Keep current defaults at API=15, PgBouncer=25.

---

## 02 — Single-Point vs Batch Throughput

**Approach**
- Compared:
  - `GET /exp/02/contains` (single-point request)
  - `POST /exp/02/batch` (1000 points per request)
- Measured point-lookups/sec at varying VUs.

**Result**
- Single-point reached about **902 pts/s**.
- Batch endpoint reached about **645 pts/s** in this setup.

**Why**
- The serial batch query holds a connection for a long-running request.
- Many short single-point requests keep the pool saturated more effectively.

**Takeaway**
- For latency-sensitive online traffic, prefer single-point requests.
- Use batch endpoint mainly for offline/bulk jobs with relaxed latency.

---

## 03 — Parallel Batch Strategies

**Approach**
- Compared three paths:
  - `POST /exp/03/batch` (serial baseline)
  - `POST /exp/03/batch-parallel` (chunk + `Promise.all`)
  - `POST /exp/03/batch-set` (set-join approach)

**Result**
- **Chunked parallel** was strongest: **2.48x** over serial at vus=5.
- Set-join improved over serial but underperformed chunked parallel.

**Why**
- Chunking creates smaller queries that can use multiple pool connections concurrently.
- Serial baseline holds one connection for too long per large batch.

**Takeaway**
- Use `/exp/03/batch-parallel` for large bulk batch processing.

---

## 04 — Geometry Simplification

**Approach**
- Precomputed simplified polygon tables and measured:
  - accuracy (IoU, FP/FN)
  - throughput/latency gains

**Result**
- `simple_10` (10m tolerance):
  - **2.48x speedup**
  - **IoU=0.9993**
  - Very low observed error rates

**Tradeoff curve**
- Coarser simplifications (100m, 500m, 1000m) improve speed more but lose too much accuracy for general use.

**Takeaway**
- `simple_10` is the production sweet spot.

---

## 05 — Batch Algorithm Comparison

**Approach**
- Compared three implementations:
  - `POST /exp/05/batch` (serial LATERAL baseline)
  - `POST /exp/05/batch-json` (JSON expansion, set-based)
  - `POST /exp/05/batch-temp` (temp table)
- Added parity checks to ensure equal outputs before interpreting performance.

**Correctness**
- `experiments/05_batch_algorithms/parity.ts` validates all three methods return equivalent results.
- Parity scenarios passed.

**Performance result**
- Documented finding: **JSON expansion** is:
  - about **3.8% faster** than temp table
  - about **26.4% faster** than serial LATERAL at VU=10

**Why JSON wins**
- Set-based execution (fewer planning/round-trip costs)
- Better connection hold-time behavior
- Better index/cache locality under concurrency

**Takeaway**
- Use `/exp/05/batch-json` as the preferred batch endpoint.

---

## How to Run Experiments

From repo root, run with `tsx`:

```bash
npx tsx experiments/01_connection_pooling/run.ts
npx tsx experiments/02_batch_vs_single/run.ts
npx tsx experiments/03_parallel_batch/run.ts
npx tsx experiments/04_geometry_simplification/run.ts
npx tsx experiments/04_geometry_simplification/accuracy.ts
npx tsx experiments/05_batch_algorithms/run.ts
npx tsx experiments/05_batch_algorithms/parity.ts
```

Benchmark outputs are written under `benchmark-results/`.
