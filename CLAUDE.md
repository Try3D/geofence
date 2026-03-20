# CLAUDE.md — Geofence Project Notes

## ⚠️ CRITICAL: Bash Tool Behavior with Benchmarks

**When running benchmark scripts (npx tsx experiments/NN_*/run.ts):**
- **DO NOT rely on the bash tool's default 2-minute timeout**
- **Better yet: Do NOT set a timeout at all** — let the command complete naturally
- Benchmarks with 10 requests per variant × 3 batch sizes × 3 variants = ~30 total requests, each taking 100-1000ms
- If you omit the timeout parameter, commands will run until completion

**Mistake made:** Running benchmarks without timeout specified → bash tool kills command at 120 seconds → results not saved → lost benchmark data

## TypeScript Execution

```bash
# Run TypeScript files directly with tsx (no need to compile first)
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

## File Creation Policy

**NEVER write files other than READMEs.** All documentation, conclusions, validation results, and findings must go inside the experiment's `README.md` file. Do not create separate documentation files.
