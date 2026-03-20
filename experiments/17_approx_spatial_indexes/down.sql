-- Exp-17: Cleanup
DROP INDEX IF EXISTS idx_hierarchy_bounds_brin;
DROP INDEX IF EXISTS idx_hierarchy_bounds_sp;
ALTER TABLE hierarchy_boundaries DROP COLUMN IF EXISTS bounds_brin;
ALTER TABLE hierarchy_boundaries DROP COLUMN IF EXISTS bounds_sp;
ANALYZE hierarchy_boundaries;
