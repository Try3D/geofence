-- Exp-17: Approximate Spatial Indexes
-- CLUSTER reorders rows by spatial position (required for effective BRIN).
-- WARNING: ACCESS EXCLUSIVE lock — run during maintenance window.
CLUSTER hierarchy_boundaries USING idx_hierarchy_bounds_4326;
ANALYZE hierarchy_boundaries;

-- SP-GiST: space-partitioning quad-tree / k-d tree
ALTER TABLE hierarchy_boundaries
  ADD COLUMN IF NOT EXISTS bounds_sp GEOMETRY(Geometry, 4326);
UPDATE hierarchy_boundaries SET bounds_sp = bounds_4326;
CREATE INDEX idx_hierarchy_bounds_sp
  ON hierarchy_boundaries USING SPGIST(bounds_sp);
ANALYZE hierarchy_boundaries;

-- BRIN: lossy block-range index (effective after CLUSTER above)
ALTER TABLE hierarchy_boundaries
  ADD COLUMN IF NOT EXISTS bounds_brin GEOMETRY(Geometry, 4326);
UPDATE hierarchy_boundaries SET bounds_brin = bounds_4326;
CREATE INDEX idx_hierarchy_bounds_brin
  ON hierarchy_boundaries USING BRIN(bounds_brin);
ANALYZE hierarchy_boundaries;
