-- Create hierarchical boundaries table for OSM administrative regions
-- Supports queries to find all levels of administrative hierarchy for a given point

CREATE TABLE IF NOT EXISTS hierarchy_boundaries (
  id BIGSERIAL PRIMARY KEY,
  osm_id BIGINT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  admin_level INT,  -- 2=country, 4=region/state, 6=city, 8=suburb/district, 10=neighborhood
  hierarchy_level TEXT,  -- 'country', 'region', 'city', 'suburb', 'neighborhood'
  parent_id BIGINT REFERENCES hierarchy_boundaries(id) ON DELETE SET NULL,
  ancestors BIGINT[],  -- Array of ancestor IDs from root (country) to parent
  depth INT DEFAULT 0,  -- 0=root (country), increasing downward
  bounds GEOMETRY(Geometry, 3857) NOT NULL,
  area_m2 DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX idx_hierarchy_bounds ON hierarchy_boundaries USING GIST(bounds);
CREATE INDEX idx_hierarchy_parent ON hierarchy_boundaries(parent_id);
CREATE INDEX idx_hierarchy_ancestors ON hierarchy_boundaries USING GIN(ancestors);
CREATE INDEX idx_hierarchy_level ON hierarchy_boundaries(hierarchy_level);
CREATE INDEX idx_hierarchy_osm_id ON hierarchy_boundaries(osm_id);
CREATE INDEX idx_hierarchy_admin ON hierarchy_boundaries(admin_level);

-- Create function to recursively find all ancestors
CREATE OR REPLACE FUNCTION get_hierarchy_path(boundary_id BIGINT)
RETURNS TABLE(id BIGINT, osm_id BIGINT, name TEXT, hierarchy_level TEXT, admin_level INT, depth INT) AS $$
WITH RECURSIVE path AS (
  SELECT id, osm_id, name, hierarchy_level, admin_level, depth, parent_id
  FROM hierarchy_boundaries
  WHERE id = boundary_id
  
  UNION ALL
  
  SELECT hb.id, hb.osm_id, hb.name, hb.hierarchy_level, hb.admin_level, hb.depth, hb.parent_id
  FROM hierarchy_boundaries hb
  INNER JOIN path ON hb.id = path.parent_id
)
SELECT id, osm_id, name, hierarchy_level, admin_level, depth FROM path ORDER BY depth;
$$ LANGUAGE SQL;

-- Create function to find hierarchy for a point
CREATE OR REPLACE FUNCTION find_hierarchy_for_point(
  point_geom GEOMETRY,
  max_results INT DEFAULT 5
)
RETURNS TABLE(id BIGINT, osm_id BIGINT, name TEXT, hierarchy_level TEXT, admin_level INT, depth INT) AS $$
WITH point_match AS (
  SELECT hb.id
  FROM hierarchy_boundaries hb
  WHERE ST_Contains(hb.bounds, point_geom)
  ORDER BY hb.depth DESC
  LIMIT 1
)
SELECT * FROM get_hierarchy_path((SELECT id FROM point_match));
$$ LANGUAGE SQL;

-- Create function to get all children of a boundary
CREATE OR REPLACE FUNCTION get_children(boundary_id BIGINT)
RETURNS TABLE(id BIGINT, osm_id BIGINT, name TEXT, hierarchy_level TEXT, admin_level INT, depth INT) AS $$
SELECT id, osm_id, name, hierarchy_level, admin_level, depth
FROM hierarchy_boundaries
WHERE parent_id = boundary_id
ORDER BY depth, name;
$$ LANGUAGE SQL;
