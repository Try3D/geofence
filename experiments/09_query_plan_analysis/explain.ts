import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "gis",
  user: process.env.DB_USER || "gis",
  password: process.env.DB_PASSWORD || "gis",
});

// Generate random points
function generateRandomPoints(count: number): Array<{ lon: number; lat: number }> {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lon: -5 + Math.random() * 10,
      lat: 41 + Math.random() * 9,
    });
  }
  return points;
}

// Test queries
const QUERIES = {
  "baseline (no bbox)": `
    SELECT (pts.ordinality - 1)::int AS idx,
           COALESCE(
             array_agg(
               json_build_object('osm_id', p.osm_id::text, 'name', COALESCE(p.name, p.tags->'name'))
               ORDER BY p.osm_id
             ) FILTER (WHERE p.osm_id IS NOT NULL),
             '{}'::json[]
           ) AS matches
    FROM (
      SELECT ordinality,
             ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    ) pts
    LEFT JOIN planet_osm_polygon p ON ST_Covers(p.way, pts.g)
    GROUP BY pts.ordinality
    ORDER BY pts.ordinality
  `,

  "with bbox filter": `
    SELECT (pts.ordinality - 1)::int AS idx,
           COALESCE(
             array_agg(
               json_build_object('osm_id', p.osm_id::text, 'name', COALESCE(p.name, p.tags->'name'))
               ORDER BY p.osm_id
             ) FILTER (WHERE p.osm_id IS NOT NULL),
             '{}'::json[]
           ) AS matches
    FROM (
      SELECT ordinality,
             ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    ) pts
    LEFT JOIN planet_osm_polygon p ON (p.way && pts.g) AND ST_Covers(p.way, pts.g)
    GROUP BY pts.ordinality
    ORDER BY pts.ordinality
  `,
};

interface PlanNode {
  [key: string]: any;
  "Node Type"?: string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Filter"?: string;
  "Rows"?: number;
  "Actual Rows"?: number;
  "Actual Total Time"?: number;
  "Execution Time"?: number;
  "Planning Time"?: number;
  "Plans"?: PlanNode[];
}

async function analyzePlan(queryName: string, query: string, points: Array<{ lon: number; lat: number }>) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 ${queryName.toUpperCase()}`);
  console.log("=".repeat(80));

  try {
    const lons = points.map((p) => p.lon);
    const lats = points.map((p) => p.lat);

    // EXPLAIN ANALYZE
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
    const result = await pool.query(explainQuery, [lons, lats]);
    const plan = result.rows[0][0] as PlanNode[];

    if (!plan || !plan[0]) {
      console.error("No plan found");
      return;
    }

    const rootPlan = plan[0];
    console.log(`\nExecution Time: ${rootPlan["Execution Time"]?.toFixed(2)}ms`);
    console.log(`Planning Time: ${rootPlan["Planning Time"]?.toFixed(2)}ms`);

    // Extract interesting details from the plan
    function printPlanNode(node: PlanNode, indent: number = 0) {
      const prefix = "  ".repeat(indent);
      const nodeType = node["Node Type"] || "Unknown";

      console.log(`${prefix}→ ${nodeType}`);

      if (node["Relation Name"]) {
        console.log(`${prefix}  Table: ${node["Relation Name"]}`);
      }
      if (node["Index Name"]) {
        console.log(`${prefix}  Index: ${node["Index Name"]}`);
      }
      if (node["Index Cond"]) {
        console.log(`${prefix}  Index Condition: ${node["Index Cond"]}`);
      }
      if (node["Filter"]) {
        console.log(`${prefix}  Filter: ${node["Filter"]}`);
      }
      if (node["Rows"]) {
        console.log(`${prefix}  Est. Rows: ${node["Rows"]}`);
      }
      if (node["Actual Rows"]) {
        console.log(`${prefix}  Actual Rows: ${node["Actual Rows"]}`);
      }
      if (node["Actual Total Time"]) {
        console.log(`${prefix}  Actual Time: ${node["Actual Total Time"]?.toFixed(2)}ms`);
      }

      if (node["Plans"] && node["Plans"].length > 0) {
        for (const subPlan of node["Plans"]) {
          printPlanNode(subPlan, indent + 1);
        }
      }
    }

    console.log("\nQuery Plan:");
    printPlanNode(rootPlan);

    // Extract key metrics
    const metrics = {
      executionTime: rootPlan["Execution Time"],
      planningTime: rootPlan["Planning Time"],
      buffers: rootPlan["Buffers"],
    };

    return metrics;
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  console.log(
    "=".repeat(80) +
      "\n  Query Plan Analysis: EXPLAIN ANALYZE for Bbox Filter Impact (exp-09)\n" +
      "=".repeat(80)
  );

  // Test with batch size 10 for clear plan differences
  const points = generateRandomPoints(10);
  console.log(`\nAnalyzing ${points.length} random points in France...`);
  console.log(`Points: ${points.slice(0, 3).map((p) => `(${p.lon.toFixed(2)}, ${p.lat.toFixed(2)})`).join(", ")} ...`);

  const results: Record<string, any> = {};

  for (const [queryName, query] of Object.entries(QUERIES)) {
    const metrics = await analyzePlan(queryName, query, points);
    if (metrics) {
      results[queryName] = metrics;
    }
  }

  // Summary comparison
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 SUMMARY COMPARISON");
  console.log("=".repeat(80));

  const baseline = results["baseline (no bbox)"];
  const withBbox = results["with bbox filter"];

  if (baseline && withBbox) {
    const timeReduction = ((baseline.executionTime - withBbox.executionTime) / baseline.executionTime) * 100;
    console.log(`\nExecution Time Improvement:  ${baseline.executionTime?.toFixed(2)}ms → ${withBbox.executionTime?.toFixed(2)}ms (${timeReduction.toFixed(1)}% faster)`);
  }

  console.log("\n✅ Analysis complete. Plans saved above.\n");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
