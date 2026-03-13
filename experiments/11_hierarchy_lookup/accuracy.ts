import pg from "pg";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const DB_URL = process.env.DATABASE_URL || "postgresql://gis:gis@localhost:5432/gis";

// Generate N random points that actually fall inside France's admin boundary
async function randomPointsInsideFrance(count: number): Promise<Array<{ lon: number; lat: number }>> {
  const client = new pg.Client(DB_URL);
  await client.connect();

  try {
    // Use rejection sampling inside the France polygon (SRID 4326)
    const result = await client.query<{ lon: number; lat: number }>(`
      WITH france AS (
        SELECT ST_Transform(way, 4326) AS geom
        FROM planet_osm_polygon
        WHERE name = 'France' AND admin_level = '2'
        LIMIT 1
      ),
      bbox AS (
        SELECT
          ST_XMin(geom) AS xmin, ST_XMax(geom) AS xmax,
          ST_YMin(geom) AS ymin, ST_YMax(geom) AS ymax,
          geom
        FROM france
      ),
      candidates AS (
        SELECT
          xmin + random() * (xmax - xmin) AS lon,
          ymin + random() * (ymax - ymin) AS lat,
          geom
        FROM bbox, generate_series(1, $1 * 5)  -- oversample to account for rejection
      )
      SELECT lon, lat
      FROM candidates
      WHERE ST_Contains(geom, ST_SetSRID(ST_Point(lon, lat), 4326))
      LIMIT $1
    `, [count]);

    return result.rows;
  } finally {
    await client.end();
  }
}

async function queryVariant(
  endpoint: string,
  points: Array<{ lon: number; lat: number }>
): Promise<any> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });

  if (!response.ok) {
    throw new Error(`${endpoint} failed: ${response.status}`);
  }

  return response.json();
}

async function main() {
  const N = 500;
  console.log("=".repeat(80));
  console.log("  Accuracy Validation: Hierarchical Boundary Lookups (exp-11)");
  console.log("=".repeat(80));

  console.log(`\nGenerating ${N} random points inside France's actual boundary...`);
  const points = await randomPointsInsideFrance(N);
  console.log(`  Got ${points.length} points (rejection-sampled inside France polygon)\n`);

  if (points.length < N) {
    console.warn(`  WARNING: only got ${points.length}/${N} points — oversample factor may need increasing`);
  }

  process.stdout.write("  → baseline (/exp/11/baseline)... ");
  const baselineResp = await queryVariant("/exp/11/baseline", points);
  console.log(`done (${baselineResp.results.length} results)`);

  process.stdout.write("  → normal   (/exp/11/normal)...   ");
  const normalResp = await queryVariant("/exp/11/normal", points);
  console.log(`done (${normalResp.results.length} results)`);

  // Index results by point index
  const baselineHit = new Map<number, any>();
  const normalHit = new Map<number, any>();

  for (const r of baselineResp.results) {
    if (r.hierarchy && r.hierarchy.length > 0) baselineHit.set(Number(r.idx), r);
  }
  for (const r of normalResp.results) {
    if (r.hierarchy && r.hierarchy.length > 0) normalHit.set(Number(r.idx), r);
  }

  // Coverage breakdown
  let bothHit = 0;
  let onlyBaseline = 0;
  let onlyNormal = 0;
  let neither = 0;

  for (let i = 0; i < points.length; i++) {
    const inBase = baselineHit.has(i);
    const inNorm = normalHit.has(i);
    if (inBase && inNorm) bothHit++;
    else if (inBase) onlyBaseline++;
    else if (inNorm) onlyNormal++;
    else neither++;
  }

  const pct = (n: number, denom = points.length) => `${n} (${((n / denom) * 100).toFixed(1)}%)`;

  console.log("\n── Coverage breakdown (points inside France boundary) ──────────────────────");
  console.log(`  Both hit:       ${pct(bothHit)}`);
  console.log(`  Only baseline:  ${pct(onlyBaseline)}  ← planet_osm_polygon has data, hierarchy doesn't`);
  console.log(`  Only normal:    ${pct(onlyNormal)}  ← hierarchy has data, planet_osm_polygon doesn't`);
  console.log(`  Neither:        ${pct(neither)}  ← inside France but no admin boundary found`);

  // osm_id agreement for overlapping hits
  let sameOsmId = 0;
  let diffOsmId = 0;

  for (let i = 0; i < points.length; i++) {
    if (!baselineHit.has(i) || !normalHit.has(i)) continue;
    const baseOsmId = baselineHit.get(i)!.hierarchy[0]?.osm_id;
    const normOsmId = normalHit.get(i)!.hierarchy[0]?.osm_id;
    if (baseOsmId === normOsmId) sameOsmId++;
    else diffOsmId++;
  }

  console.log(`\n── osm_id agreement (${bothHit} points where both hit) ─────────────────────────`);
  console.log(`  Same osm_id:    ${pct(sameOsmId, bothHit || 1)}  of ${bothHit} overlapping hits`);
  console.log(`  Different:      ${pct(diffOsmId, bothHit || 1)}  ← boundary assigned differs between tables`);

  console.log("\n── Match rates ─────────────────────────────────────────────────────────────");
  console.log(`  baseline:  ${baselineHit.size}/${points.length} matched (${((baselineHit.size / points.length) * 100).toFixed(1)}%)`);
  console.log(`  normal:    ${normalHit.size}/${points.length} matched (${((normalHit.size / points.length) * 100).toFixed(1)}%)`);

  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
