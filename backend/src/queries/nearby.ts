export function getNearbyQuery(): string {
  return `
    WITH pt AS (
      SELECT ST_Transform(ST_SetSRID(ST_Point($1, $2), 4326), 3857) AS g
    )
    SELECT p.osm_id::text,
           COALESCE(p.name, p.tags->'name') AS name,
           ST_Distance(p.way, pt.g) AS distance_m
    FROM planet_osm_polygon p, pt
    WHERE ST_DWithin(p.way, pt.g, $3)
    ORDER BY p.way <-> pt.g
    LIMIT $4
  `;
}
