use axum::{
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use std::{env, fmt::Write, net::SocketAddr};

#[derive(Clone)]
struct AppState {
    pool: sqlx::PgPool,
}

#[derive(Deserialize)]
struct GeoPoint {
    lon: f64,
    lat: f64,
}

#[derive(Deserialize)]
struct BatchRequest {
    points: Vec<GeoPoint>,
}

#[derive(Serialize)]
struct HierarchyResult {
    idx: i64,
    hierarchy: Value,
}

#[derive(Serialize)]
struct BatchResponse {
    count: usize,
    results: Vec<HierarchyResult>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// Transform to 3857 (current Express baseline)
const BASELINE_QUERY: &str = r#"
    WITH points AS (
      SELECT (ordinality - 1) AS idx, lon, lat
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    ),
    pts AS (
      SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM points
    ),
    deepest_match AS (
      SELECT pts.idx, hb.id, hb.osm_id, hb.name, hb.admin_level, hb.depth,
        ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY hb.depth DESC) as rn
      FROM pts
      JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds, pts.g)
    )
    SELECT idx,
      json_build_array(json_build_object(
        'id', id, 'osm_id', osm_id, 'name', name,
        'admin_level', admin_level, 'depth', depth
      )) as hierarchy
    FROM deepest_match WHERE rn = 1
"#;

/// Native 4326, serde_json decode (current axum variant)
const NATIVE_JSON_QUERY: &str = r#"
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
"#;

/// Native 4326, cast to TEXT — skips serde_json parse/reserialize cycle
const NATIVE_RAW_QUERY: &str = r#"
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
      ))::text as hierarchy
    FROM deepest_match WHERE rn = 1
"#;

/// Entire response JSON built inside postgres — Rust forwards raw bytes only
const NATIVE_FULL_QUERY: &str = r#"
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
    ),
    matched AS (
      SELECT idx,
        json_build_array(json_build_object(
          'id', id, 'osm_id', osm_id, 'name', name,
          'admin_level', admin_level, 'depth', depth
        )) as hierarchy
      FROM deepest_match WHERE rn = 1
    ),
    all_pts AS (
      SELECT p.idx, COALESCE(m.hierarchy, '[]'::json) AS hierarchy
      FROM points p LEFT JOIN matched m ON p.idx = m.idx
    )
    SELECT json_build_object(
      'count', (SELECT count(*) FROM points),
      'results', json_agg(json_build_object('idx', idx, 'hierarchy', hierarchy) ORDER BY idx)
    )::text AS response
    FROM all_pts
"#;

// ── Handlers ─────────────────────────────────────────────────────────────────

/// /exp/13/baseline — serde_json round-trip, 3857 transform
async fn baseline_handler(
    State(state): State<AppState>,
    Json(payload): Json<BatchRequest>,
) -> impl IntoResponse {
    let n = payload.points.len();
    let (lons, lats) = split_coords(payload.points);

    match sqlx::query_as::<_, (i64, Value)>(BASELINE_QUERY)
        .bind(&lons)
        .bind(&lats)
        .fetch_all(&state.pool)
        .await
    {
        Ok(rows) => Json(build_response(n, rows)).into_response(),
        Err(e) => err_response(e),
    }
}

/// /exp/13/native — serde_json round-trip, native 4326
async fn native_handler(
    State(state): State<AppState>,
    Json(payload): Json<BatchRequest>,
) -> impl IntoResponse {
    let n = payload.points.len();
    let (lons, lats) = split_coords(payload.points);

    match sqlx::query_as::<_, (i64, Value)>(NATIVE_JSON_QUERY)
        .bind(&lons)
        .bind(&lats)
        .fetch_all(&state.pool)
        .await
    {
        Ok(rows) => Json(build_response(n, rows)).into_response(),
        Err(e) => err_response(e),
    }
}

/// /exp/13/native-raw — hierarchy decoded as String, manual JSON, no serde round-trip
async fn native_raw_handler(
    State(state): State<AppState>,
    Json(payload): Json<BatchRequest>,
) -> impl IntoResponse {
    let n = payload.points.len();
    let (lons, lats) = split_coords(payload.points);

    match sqlx::query_as::<_, (i64, String)>(NATIVE_RAW_QUERY)
        .bind(&lons)
        .bind(&lats)
        .fetch_all(&state.pool)
        .await
    {
        Ok(rows) => {
            let mut slots: Vec<Option<String>> = (0..n).map(|_| None).collect();
            for (idx, h) in rows {
                if let Some(slot) = slots.get_mut(idx as usize) {
                    *slot = Some(h);
                }
            }
            let mut body = format!(r#"{{"count":{},"results":["#, n);
            for i in 0..n {
                if i > 0 {
                    body.push(',');
                }
                let h = slots[i].as_deref().unwrap_or("[]");
                write!(body, r#"{{"idx":{},"hierarchy":{}}}"#, i, h).unwrap();
            }
            body.push_str("]}");
            (StatusCode::OK, [(header::CONTENT_TYPE, "application/json")], body).into_response()
        }
        Err(e) => err_response(e),
    }
}

/// /exp/13/native-full — entire JSON built in postgres, Rust forwards raw bytes
async fn native_full_handler(
    State(state): State<AppState>,
    Json(payload): Json<BatchRequest>,
) -> impl IntoResponse {
    let (lons, lats) = split_coords(payload.points);

    match sqlx::query_scalar::<_, String>(NATIVE_FULL_QUERY)
        .bind(&lons)
        .bind(&lats)
        .fetch_one(&state.pool)
        .await
    {
        Ok(json) => {
            (StatusCode::OK, [(header::CONTENT_TYPE, "application/json")], json).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn split_coords(points: Vec<GeoPoint>) -> (Vec<f64>, Vec<f64>) {
    points.into_iter().map(|p| (p.lon, p.lat)).unzip()
}

fn build_response(n: usize, rows: Vec<(i64, Value)>) -> BatchResponse {
    let mut results: Vec<HierarchyResult> = (0..n)
        .map(|i| HierarchyResult {
            idx: i as i64,
            hierarchy: Value::Array(vec![]),
        })
        .collect();
    for (idx, hierarchy) in rows {
        if let Some(r) = results.get_mut(idx as usize) {
            r.hierarchy = hierarchy;
        }
    }
    BatchResponse { count: n, results }
}

fn err_response(e: sqlx::Error) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": e.to_string() })),
    )
        .into_response()
}

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true }))
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://gis:gis@localhost:5432/gis".to_string());
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);
    let max_connections: u32 = env::var("DB_POOL_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(40);

    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let state = AppState { pool };

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/exp/13/baseline", post(baseline_handler))
        .route("/exp/13/native", post(native_handler))
        .route("/exp/13/native-raw", post(native_raw_handler))
        .route("/exp/13/native-full", post(native_full_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind");

    println!("Axum server listening on http://localhost:{port}");
    println!("Routes:");
    println!("  POST /exp/13/baseline    — serde_json + ST_Transform 3857");
    println!("  POST /exp/13/native      — serde_json + native 4326");
    println!("  POST /exp/13/native-raw  — String + manual JSON + native 4326");
    println!("  POST /exp/13/native-full — entire JSON in postgres + native 4326");
    axum::serve(listener, app).await.unwrap();
}
