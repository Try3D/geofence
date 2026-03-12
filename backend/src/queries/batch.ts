export function getLateralBatchQuery(table: string): string {
  return `
    WITH points AS (
      SELECT (ordinality - 1) AS idx, lon, lat
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    ),
    pts AS (
      SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM points
    )
    SELECT pts.idx::int,
           match.osm_id,
           match.name
    FROM pts
    CROSS JOIN LATERAL (
      SELECT p.osm_id::text,
             COALESCE(p.name, p.tags->'name') AS name
      FROM ${table} p
      WHERE ST_Covers(p.way, pts.g)
      LIMIT $3
    ) match
  `;
}

export function getJsonBatchQuery(table: string): string {
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

export function getParallelBatchQuery(): string {
  return `
    SELECT pts.idx::int,
           p.osm_id::text,
           COALESCE(p.name, p.tags->'name') AS name
    FROM (
      SELECT ordinality AS idx,
             ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    ) pts
    JOIN planet_osm_polygon p ON ST_Covers(p.way, pts.g)
    LIMIT $3
  `;
}

export function getSetBatchQuery(): string {
  return `
    SELECT pts.idx::int,
           p.osm_id::text,
           COALESCE(p.name, p.tags->'name') AS name
    FROM (
      SELECT ordinality AS idx,
             ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
      FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
    ) pts
    JOIN planet_osm_polygon p ON ST_Covers(p.way, pts.g)
    LIMIT $3
  `;
}
