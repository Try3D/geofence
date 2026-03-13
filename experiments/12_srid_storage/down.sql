-- Exp-12: cleanup
DROP INDEX IF EXISTS idx_hierarchy_bounds_4326;
ALTER TABLE hierarchy_boundaries DROP COLUMN IF EXISTS bounds_4326;
