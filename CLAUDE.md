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
npx tsx experiments/08_sql_functions/run.ts

# ✅ CORRECT: Explicit long timeout
# timeout: 600000
npx tsx experiments/08_sql_functions/run.ts

# ✅ ALSO CORRECT: No timeout parameter = runs until done
# (Do this for benchmark scripts that take 5-10 minutes)
npx tsx experiments/08_sql_functions/run.ts
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

## Benchmarking Standard: Profiler + K6

**ALL benchmarking MUST use the `Benchmark` class from `@geofence/profiler`.**

This ensures:
- Consistent load testing with k6 (configurable VUs, duration, thresholds)
- Automatic metric extraction (throughput, p95, p99, avg/med latency, failure rate)
- Standardized results format across all experiments
- Proper JSON summary exports

**Pattern:**
```typescript
import { Benchmark, randomPoints, GEOFENCE_PRESETS } from "@geofence/profiler";

const bench = new Benchmark({
  name: "Your Experiment Name",
  resultsDir: path.join(ROOT, "benchmark-results", "NN_name"),
  ...GEOFENCE_PRESETS,
  experiments: [
    {
      label: "variant-name_1000_vus=10",
      vus: 10,
      batchSize: 1000,
      extraEnv: {
        METHOD: "POST",
        TARGET_URL: `${BASE_URL}/exp/NN/variant`,
        BODY: JSON.stringify({ points: randomPoints(1000) }),
      },
    },
    // ... more experiments
  ],
});

await bench.run();
```

**Accuracy testing:** Create separate `accuracy.ts` for correctness validation (NOT a load test, just quick validation of result parity).

## Adding a new experiment

When creating experiment `NN`, follow this checklist.

1. Create `experiments/NN_short_name/` with:
   - `README.md` (hypothesis, repro, results, conclusion)
   - `run.ts` (MUST use Benchmark class + k6)
   - optional: `accuracy.ts` (separate correctness validation)
2. Create `backend/src/routes/exp-NN.ts` and define endpoints under `/exp/NN/*`.
3. Register route in `backend/src/server.ts` using `app.use("/exp/NN", expNNRoutes)`.
4. Add reusable SQL builders in `backend/src/queries/*` if shared across routes.
5. Results automatically saved to `benchmark-results/NN_short_name/result.json` by Benchmark class.
6. Verify endpoint correctness before performance claims:
   - Use `accuracy.ts` to compare results between variants
   - Verify error paths (invalid params/table/limits)
7. Run full integration checks with real HTTP calls against local backend.
8. Update docs:
   - add one-line summary to root `README.md` experiments table
   - keep full analysis inside `experiments/NN_short_name/README.md`

## Experiment README template

Each experiment README should include:

1. `# NN — Experiment Name`
2. Hypothesis
3. Method/setup
4. How to reproduce (`npx tsx ...`)
5. Results table(s) with k6 metrics (throughput, p95, p99, avg latency, failure rate)
6. Interpretation/trade-offs
7. Conclusion (clear recommendation)
8. Limitations/notes (if any)

**Important**: Only create `README.md` files. Never create separate documentation files like `LARGE_SCALE_VALIDATION.md` or similar. Put all conclusions, findings, and validation results directly in the main README.md file.

## File Creation Policy

**NEVER write files other than READMEs.** All documentation, conclusions, validation results, and findings must go inside the experiment's `README.md` file. Do not create separate documentation files.

## Experiment Numbering

Experiments are numbered sequentially:
- **exp-01**: Connection pooling — API pool=15, PgBouncer=25 optimal
- **exp-02**: Batch vs single queries — single-point parallelizes better
- **exp-03**: Parallel batch processing — Promise.all chunking 2.48× speedup
- **exp-04**: Geometry simplification — simple_10 (10m): 2.48× speedup
- **exp-05**: Batch algorithms — JSON expansion 3.8% faster than temp table
- **exp-06**: Spatial tile cache — negative result (overhead > gains)
- **exp-07**: Bounding box filter optimization — 4.4% large-batch, 368% small-batch gains
- **exp-08**: SQL functions for batch queries — query precompilation optimization
- **exp-09**: JIT impact on query performance — negligible impact (<3%) on I/O-bound workloads
- **exp-10**: Minimal payload optimization — 29% latency reduction via query projection optimization
- **exp-11**: Hierarchy lookup optimization — 97-99% speedup with precomputed hierarchies

**Important**: Always number experiments in order. Do not skip numbers or jump ahead. If you create a new experiment, check the highest number and increment by 1.
