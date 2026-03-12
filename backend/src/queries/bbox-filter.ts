/**
 * Bounding box filter optimization queries
 * Tests three variants of JSON batch processing:
 * 1. No bbox filter (baseline from exp-05)
 * 2. Explicit bbox filter (way && point)
 * 3. Explicit bbox filter with indexed point reconstruction
 */

export function getJsonBatchQueryNoBbox(table: string): string {
  return `
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
    LEFT JOIN ${table} p ON ST_Covers(p.way, pts.g)
    GROUP BY pts.ordinality
    ORDER BY pts.ordinality
  `;
}

export function getJsonBatchQueryWithBbox(table: string): string {
  return `
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
    LEFT JOIN ${table} p ON (p.way && pts.g) AND ST_Covers(p.way, pts.g)
    GROUP BY pts.ordinality
    ORDER BY pts.ordinality
  `;
}

export function getJsonBatchQueryWithBboxIndexed(table: string): string {
  return `
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
             lon,
             lat,
             ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    ) pts
    LEFT JOIN ${table} p ON (p.way && pts.g) AND ST_Covers(p.way, pts.g)
    GROUP BY pts.ordinality
    ORDER BY pts.ordinality
  `;
}
