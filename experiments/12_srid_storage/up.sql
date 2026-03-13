-- Exp-12: add 4326 column to hierarchy_boundaries for SRID storage experiment
ALTER TABLE hierarchy_boundaries ADD COLUMN IF NOT EXISTS bounds_4326 GEOMETRY(Geometry, 4326);
UPDATE hierarchy_boundaries SET bounds_4326 = ST_Transform(bounds, 4326);
CREATE INDEX idx_hierarchy_bounds_4326 ON hierarchy_boundaries USING GIST(bounds_4326);
