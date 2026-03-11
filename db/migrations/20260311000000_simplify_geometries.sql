-- 10m tolerance
CREATE TABLE IF NOT EXISTS planet_osm_polygon_simple_10 AS
  SELECT osm_id, name, tags,
         ST_SimplifyPreserveTopology(way, 10) AS way
  FROM planet_osm_polygon
  WHERE way IS NOT NULL;
CREATE INDEX IF NOT EXISTS planet_osm_polygon_simple_10_way_idx
  ON planet_osm_polygon_simple_10 USING GIST (way);

-- 100m tolerance
CREATE TABLE IF NOT EXISTS planet_osm_polygon_simple_100 AS
  SELECT osm_id, name, tags,
         ST_SimplifyPreserveTopology(way, 100) AS way
  FROM planet_osm_polygon
  WHERE way IS NOT NULL;
CREATE INDEX IF NOT EXISTS planet_osm_polygon_simple_100_way_idx
  ON planet_osm_polygon_simple_100 USING GIST (way);

-- 500m tolerance
CREATE TABLE IF NOT EXISTS planet_osm_polygon_simple_500 AS
  SELECT osm_id, name, tags,
         ST_SimplifyPreserveTopology(way, 500) AS way
  FROM planet_osm_polygon
  WHERE way IS NOT NULL;
CREATE INDEX IF NOT EXISTS planet_osm_polygon_simple_500_way_idx
  ON planet_osm_polygon_simple_500 USING GIST (way);

-- 1000m tolerance
CREATE TABLE IF NOT EXISTS planet_osm_polygon_simple_1000 AS
  SELECT osm_id, name, tags,
         ST_SimplifyPreserveTopology(way, 1000) AS way
  FROM planet_osm_polygon
  WHERE way IS NOT NULL;
CREATE INDEX IF NOT EXISTS planet_osm_polygon_simple_1000_way_idx
  ON planet_osm_polygon_simple_1000 USING GIST (way);
