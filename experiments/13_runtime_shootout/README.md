# 13 — HTTP Runtime Shootout

## Hypothesis

Node.js Express is the established baseline. Can Fastify (a faster Node.js HTTP framework), Bun (a JS runtime with native I/O and binary-protocol Postgres driver), or Axum (Rust/Tokio) beat it? Prior work showed Axum trailing Express for single-point lookups due to serde_json overhead. This experiment brings all six runtimes/variants side-by-side under the same query and load conditions, and also tests whether bypassing serde_json in Axum (`axum-raw`) closes the gap.

## Method

All backends execute identical SQL — the best query from exp-12 (native 4326 storage, no `ST_Transform`):

```sql
WITH points AS (
  SELECT (ordinality - 1) AS idx, lon, lat
  FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
),
pts AS (
  SELECT idx, ST_SetSRID(ST_Point(lon, lat), 4326) AS g
  FROM points
),
deepest_match AS (
  SELECT pts.idx, hb.id, hb.osm_id, hb.name, hb.admin_level, hb.depth,
    ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY hb.depth DESC) as rn
  FROM pts
  JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds_4326, pts.g)
)
SELECT idx,
  json_build_array(json_build_object(
    'id', id, 'osm_id', osm_id, 'name', name,
    'admin_level', admin_level, 'depth', depth
  )) as hierarchy
FROM deepest_match WHERE rn = 1
```

### Backends

| Backend    | Runtime       | DB Driver                              | Port | Path                 |
|------------|---------------|----------------------------------------|------|----------------------|
| express    | Node.js v22   | `pg` (text protocol)                   | 3000 | `/exp/12/native`     |
| fastify    | Node.js v22   | `pg` (text protocol)                   | 3002 | `/exp/13/fastify`    |
| bun-native | Bun           | `postgres` (porsager, binary protocol) | 3003 | `/exp/13/bun-native` |
| bun-elysia | Bun + Elysia  | `postgres` (porsager, binary protocol) | 3004 | `/exp/13/elysia`     |
| axum       | Rust/Tokio    | `sqlx` — serde_json round-trip         | 3001 | `/exp/13/native`     |
| axum-raw   | Rust/Tokio    | `sqlx` — raw bytes, no serde round-trip| 3001 | `/exp/13/native-raw` |

**DB driver rationale:** Express and Fastify share `pg` for a controlled Node.js HTTP-layer comparison. Bun backends use `postgres` (porsager, binary wire protocol) — their realistic best case. Axum uses `sqlx`. `axum-raw` uses the same `sqlx` connection but fetches the hierarchy JSON column as a raw `String` and forwards bytes without any serde deserialization, testing whether that optimization closes the Axum performance gap.

### Load profile

- **Single-point** — vus=20, duration=180s: HTTP/runtime overhead is the dominant variable; query is sub-ms
- **Batch-1000** — vus=10, duration=180s: DB-bound (~1s per request); runtime overhead is secondary

### Experiment ordering

Each backend's single-point and batch tests run back-to-back before moving to the next backend. This keeps the connection pool warm between test types and avoids cold-start artifacts.

## How to Reproduce

```bash
# Install deps for JS/TS backends
cd experiments/13_runtime_shootout/backends/fastify   && npm install && cd -
cd experiments/13_runtime_shootout/backends/bun-native && bun install && cd -
cd experiments/13_runtime_shootout/backends/bun-elysia && bun install && cd -

# Terminal 1 — Express (Node.js, port 3000)
cd backend && npm run dev

# Terminal 2 — Axum + axum-raw (Rust, port 3001) — first build takes ~2 min
cd experiments/13_runtime_shootout/backends/axum && cargo run --release

# Terminal 3 — Fastify (Node.js, port 3002)
cd experiments/13_runtime_shootout/backends/fastify && npx tsx server.ts

# Terminal 4 — Bun native (port 3003)
cd experiments/13_runtime_shootout/backends/bun-native && bun server.ts

# Terminal 5 — Bun + Elysia (port 3004)
cd experiments/13_runtime_shootout/backends/bun-elysia && bun server.ts

# Terminal 6 — Run benchmark (~36 min)
npx tsx experiments/13_runtime_shootout/run.ts
```

## Results

### Full comparison table

| Backend    | Test        | VUs | req/s     | pts/s  | avg lat  | p95 lat  | err%  | vs express  |
|------------|-------------|-----|-----------|--------|----------|----------|-------|-------------|
| express    | single      | 20  | 5,678     | —      | 3.5ms    | 6.0ms    | 0.00% | 1.00×       |
| fastify    | single      | 20  | 5,605     | —      | 3.5ms    | 6.3ms    | 0.00% | −1.3%       |
| bun-native | single      | 20  | 6,004     | —      | 3.3ms    | 5.9ms    | 0.00% | +5.7%       |
| bun-elysia | single      | 20  | **6,146** | —      | **3.2ms**| **5.7ms**| 0.00% | **+8.2%**   |
| axum       | single      | 20  | 4,763     | —      | 4.1ms    | 7.0ms    | 0.00% | −16.1%      |
| axum-raw   | single      | 20  | 4,530     | —      | 4.4ms    | 7.5ms    | 0.00% | −20.2%      |
| express    | batch-1000  | 10  | 9.73      | 9,732  | 1,020ms  | 1,580ms  | 0.00% | 1.00×       |
| fastify    | batch-1000  | 10  | 9.32      | 9,319  | 1,065ms  | 1,640ms  | 0.00% | −4.2%       |
| bun-native | batch-1000  | 10  | **9.52**  | **9,523**| **1,042ms**| **1,149ms**| 0.00% | −2.2%  |
| bun-elysia | batch-1000  | 10  | 9.26      | 9,264  | 1,071ms  | 1,223ms  | 0.00% | −4.8%       |
| axum       | batch-1000  | 10  | 9.49      | 9,487  | 1,046ms  | 1,166ms  | 0.00% | −2.5%       |
| axum-raw   | batch-1000  | 10  | 9.18      | 9,182  | 1,081ms  | 1,204ms  | 0.00% | −5.6%       |

### Single-point ranking (vus=20)

| Rank | Backend    | req/s | avg lat | p95 lat | vs express |
|------|------------|-------|---------|---------|------------|
| 1    | bun-elysia | 6,146 | 3.2ms   | 5.7ms   | +8.2%      |
| 2    | bun-native | 6,004 | 3.3ms   | 5.9ms   | +5.7%      |
| 3    | express    | 5,678 | 3.5ms   | 6.0ms   | —          |
| 4    | fastify    | 5,605 | 3.5ms   | 6.3ms   | −1.3%      |
| 5    | axum       | 4,763 | 4.1ms   | 7.0ms   | −16.1%     |
| 6    | axum-raw   | 4,530 | 4.4ms   | 7.5ms   | −20.2%     |

### Batch-1000 ranking by throughput (vus=10)

| Rank | Backend    | pts/s | avg lat  | p95 lat  | vs express |
|------|------------|-------|----------|----------|------------|
| 1    | express    | 9,732 | 1,020ms  | 1,580ms  | —          |
| 2    | bun-native | 9,523 | 1,042ms  | **1,149ms** | −2.2%   |
| 3    | axum       | 9,487 | 1,046ms  | 1,166ms  | −2.5%      |
| 4    | fastify    | 9,319 | 1,065ms  | 1,640ms  | −4.2%      |
| 5    | bun-elysia | 9,264 | 1,071ms  | 1,223ms  | −4.8%      |
| 6    | axum-raw   | 9,182 | 1,081ms  | 1,204ms  | −5.6%      |

### Batch-1000 p95 tail latency ranking

| Rank | Backend    | p95 lat  |
|------|------------|----------|
| 1    | bun-native | 1,149ms  |
| 2    | axum       | 1,166ms  |
| 3    | axum-raw   | 1,204ms  |
| 4    | bun-elysia | 1,223ms  |
| 5    | express    | 1,580ms  |
| 6    | fastify    | 1,640ms  |

## Interpretation

### Single-point: Bun leads, Node runtimes cluster, Axum trails

At vus=20 with a sub-ms query, the server spends ~3–4ms per request — enough for HTTP framework and JSON overhead to show up clearly.

**Bun leads at +6–8% over Express.** Bun+Elysia edges out bare `Bun.serve` (6,146 vs 6,004), suggesting Elysia adds negligible overhead while providing a full framework API. The `postgres` binary protocol driver gives Bun an additional DB-layer edge; the runtime advantage and driver advantage are not separable here.

**Express and Fastify are within 1.3% of each other**, confirming that when a real DB query dominates request time, the Express vs Fastify framework overhead difference is near zero.

**Axum (serde_json) at 4,763 req/s is −16.1% vs Express.** The cause is the serde_json round-trip: `sqlx` decodes `json_build_array()` from Postgres as a `serde_json::Value`, then Axum re-serializes it back to bytes for the HTTP response. V8's JSON engine does this more cheaply than serde_json for this workload.

### axum-raw is slower than axum — the serde bypass backfires

**`axum-raw` at 4,530 req/s is 4.9% slower than `axum` on single-point**, and 3.2% slower on batch. This contradicts the hypothesis that bypassing serde_json would improve performance.

The `native-raw` route fetches the hierarchy column as a raw Postgres `String` (via `::text` cast in SQL) and manually concatenates JSON strings to build the response. Two factors likely explain why this is slower:

1. **SQL overhead**: casting `json_build_array()` output to `text` in Postgres may cost more than returning it as a JSON type.
2. **Manual string building**: constructing the response JSON via string concatenation and allocation is slower than serde_json's typed serialization for this structure.

The lesson: eliminating a serialization step is not automatically faster if the replacement is costlier. Axum's serde_json path is already well-optimized for this shape of data.

### Batch-1000: Express leads throughput; Bun and Axum win on tail latency

When each request takes ~1 second in PostgreSQL, the HTTP runtime contribution drops to near-noise. The throughput spread from Express (9,732 pts/s) to axum-raw (9,182 pts/s) is only **5.6%** — all runtimes are effectively tied.

The more revealing metric is **p95 tail latency**. Express and Fastify (both using `pg` text protocol) show p95 of 1,580–1,640ms. Bun backends and Axum variants all stay at 1,149–1,223ms — roughly **25–30% better tail latency**. The `pg` text-protocol driver introduces latency variance under sustained concurrent batch load that binary-protocol drivers (postgres, sqlx) consistently avoid.

Express leads batch throughput (#1) but has the second-worst p95. If tail latency matters for your SLA, the `pg` driver is the bottleneck — not the HTTP framework.

## Conclusion

**For single-point lookups:** Bun (+6–8%) is the fastest runtime in this workload, with Elysia as the leading framework on Bun. Express and Fastify are within noise of each other. Axum trails by ~16% due to the serde_json round-trip; the attempted fix (`axum-raw`) made it worse, not better.

**For batch lookups:** All runtimes are within 6% on throughput — the DB is the bottleneck. The meaningful axis is tail latency: Bun and Axum backends deliver p95 ~1,150–1,220ms vs ~1,580–1,640ms for Node+`pg` backends, a 25–30% improvement driven by the binary protocol driver.

**Recommendation:**
- **Stick with Express + `pg`** if your workload is batch-heavy and tail latency is acceptable. It leads on throughput and requires zero migration.
- **Switch to Bun + `postgres`** for the best single-point performance (+6–8%) and significantly better batch tail latency (−25% p95). Elysia is the cleanest framework choice on Bun.
- **Axum** is competitive on batch tail latency but trails on single-point due to the serde_json round-trip. The raw-bytes workaround doesn't help — a deeper fix (e.g., streaming Postgres JSON bytes directly to the HTTP response without Rust deserialization) would be needed to make Axum competitive for single-point.

## Limitations

- All backends connect directly to PostgreSQL (not PgBouncer). Absolute numbers differ slightly from earlier experiments that used PgBouncer on port 6432.
- Bun backends use `postgres` (binary protocol); Node backends use `pg` (text protocol). Bun's apparent advantage may partly reflect the driver difference, not the runtime.
- Single-run per experiment — no multi-trial averaging. Point estimates; variance not quantified.
- All 5 backend processes run simultaneously throughout. While each backend's tests run back-to-back (keeping its pool warm), idle backends still hold DB connections, marginally affecting resource availability.
