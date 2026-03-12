# CLAUDE.md — Geofence Project Notes

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
