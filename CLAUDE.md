# CLAUDE.md — Geofence Project Notes

## ⚠️ CRITICAL: Bash Tool Behavior with Benchmarks

**When running benchmark scripts (npx tsx experiments/NN_*/run.ts):**
- **DO NOT rely on the bash tool's default 2-minute timeout**
- Set `timeout: 600000` (10 minutes minimum) when calling bash
- **Better yet: Do NOT set a timeout at all** — let the command complete naturally
- Benchmarks with 10 requests per variant × 3 batch sizes × 3 variants = ~30 total requests, each taking 100-1000ms
- If you omit the timeout parameter, commands will run until completion

**Mistake made:** Running benchmarks without timeout specified → bash tool kills command at 120 seconds → results not saved → lost benchmark data

**Fix applied:** 
- Reduced benchmark script requests from 50 to 10 per variant (for speed)
- Always specify `timeout: 600000` for any `npx tsx experiments/*/run.ts` calls
- Or specify no timeout at all and let it complete

```bash
# ❌ WRONG: Uses default 120s timeout, kills benchmark mid-run
npx tsx experiments/10_sql_functions/run.ts

# ✅ CORRECT: Explicit long timeout
# timeout: 600000
npx tsx experiments/10_sql_functions/run.ts

# ✅ ALSO CORRECT: No timeout parameter = runs until done
# (Do this for benchmark scripts that take 5-10 minutes)
npx tsx experiments/10_sql_functions/run.ts
```

## TypeScript Execution

```bash
# Run TypeScript files directly
npx tsx experiments/05_batch_algorithms/run.ts
npx tsx experiments/05_batch_algorithms/parity.ts
```

## Migrations

Run migrations using the **system `sqlx` CLI**:

```bash
sqlx migrate run --source db/migrations --database-url postgresql://gis:gis@localhost:5432/gis
```

## Experiment workflow (how we work)

This repo is experiment-driven. Backend route design and experiment scripts evolve together.

### Ground rules

- Number experiments as `experiments/NN_short_name/`.
- Keep backend endpoints experiment-scoped: `/exp/NN/*`.
- Keep `backend/src/server.ts` minimal (Express setup + route registration).
- Keep route handlers thin (parse, validate, run query, respond).
- Reuse shared modules; avoid copy/paste logic:
  - `backend/src/utils/validators.ts`
  - `backend/src/utils/errorHandler.ts`
  - `backend/src/queries/*.ts`
  - `backend/src/types/index.ts`
- Experiment scripts must use `API_BASE_URL` (default `http://localhost:3000`).
- Put detailed results in each experiment README, not in root `README.md`.

## Adding a new experiment

When creating experiment `NN`, follow this checklist.

1. Create `experiments/NN_short_name/` with:
   - `README.md` (hypothesis, repro, results, conclusion)
   - `run.ts` (benchmark runner)
   - optional: `parity.ts`, `accuracy.ts`
2. Create `backend/src/routes/exp-NN.ts` and define endpoints under `/exp/NN/*`.
3. Register route in `backend/src/server.ts` using `app.use("/exp/NN", expNNRoutes)`.
4. Add reusable SQL builders in `backend/src/queries/*` if shared across routes.
5. Use env-based base URL in scripts:
   - `const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";`
6. Write results to `benchmark-results/NN_short_name/`.
7. Verify endpoint correctness before performance claims:
   - parity test if comparing multiple implementations
   - verify error paths (invalid params/table/limits)
8. Run full integration checks with real HTTP calls against local backend.
9. Update docs:
   - add one-line summary to root `README.md` experiments table
   - keep full analysis inside `experiments/NN_short_name/README.md`

## Experiment README template

Each experiment README should include:

1. `# NN — Experiment Name`
2. Hypothesis
3. Method/setup
4. How to reproduce (`npx tsx ...`)
5. Results table(s)
6. Interpretation/trade-offs
7. Conclusion (clear recommendation)
8. Limitations/notes (if any)

## Experiment Numbering

Experiments are numbered sequentially:
- **exp-01**: Connection pooling
- **exp-02**: Batch vs single queries
- **exp-03**: Parallel batch processing
- **exp-04**: Geometry simplification
- **exp-05**: Batch algorithms (JSON expansion vs temp table)
- **exp-06**: Spatial tile cache (negative result)
- **exp-07**: Bounding box filter optimization (4.4% throughput gain)
- **exp-08**: Small batch size performance gains (600%+ improvement on 10-point batches)
- **exp-09**: Query plan analysis with EXPLAIN ANALYZE (index usage confirmation)

**Important**: Always number experiments in order. Do not skip numbers or jump ahead. If you create a new experiment, check the highest number and increment by 1.
