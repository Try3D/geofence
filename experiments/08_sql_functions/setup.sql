-- SQL Function for batch lookup optimization
-- This function consolidates the batch lookup logic into a single server-side construct
-- to reduce query text variability and planning overhead

CREATE OR REPLACE FUNCTION batch_lookup_lateral(
  lon_arr float8[],
  lat_arr float8[],
  table_name text
) RETURNS TABLE (idx int, osm_id text, name text) AS $$
DECLARE
  query_text text;
BEGIN
  -- Build dynamic query with table name
  query_text := format('
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
             COALESCE(p.name, p.tags->''name'') AS name
      FROM %I p
      WHERE ST_Covers(p.way, pts.g)
    ) match
  ', table_name);

  RETURN QUERY EXECUTE query_text USING lon_arr, lat_arr;
END;
$$ LANGUAGE plpgsql;
