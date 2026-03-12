export function getContainsQuery(table: string): string {
  return `
    WITH pt AS (
      SELECT ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857) AS g
    )
    SELECT p.osm_id::text,
           COALESCE(p.name, p.tags->'name') AS name
    FROM ${table} p, pt
    WHERE ST_Covers(p.way, pt.g)
    LIMIT $3
  `;
}
