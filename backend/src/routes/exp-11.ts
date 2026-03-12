import express, { Request, Response } from "express";
import { asyncHandler } from "../utils/errorHandler";
import { formatError } from "../utils/errorHandler";
import {
  validateBatchPayload,
  parseCoordinates,
  parsePositiveInt,
} from "../utils/validators";
import { pool } from "../db";

const router = express.Router();

interface HierarchyMatch {
  idx: number;
  hierarchy: Array<{
    id: number | null;
    osm_id: number;
    name: string;
    admin_level: number;
    depth: number;
  }>;
}

// BASELINE: Simple full table scan on planet_osm_polygon (no optimization)
router.post(
  "/baseline",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as {
        points: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);

      const query = `
        WITH points AS (
          SELECT (ordinality - 1) AS idx, lon, lat
          FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
        ),
        pts AS (
          SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
          FROM points
        ),
        matches AS (
          SELECT 
            pts.idx,
            pop.osm_id,
            pop.name,
            pop.admin_level::int,
            ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY pop.admin_level::int DESC) as rn
          FROM pts
          JOIN planet_osm_polygon pop ON ST_Contains(pop.way, pts.g)
          WHERE pop.admin_level IS NOT NULL
            AND pop.admin_level::int IN (2, 4, 6, 8, 9, 10)
        )
        SELECT 
          idx,
          json_build_array(
            json_build_object(
              'id', NULL,
              'osm_id', osm_id,
              'name', name,
              'admin_level', admin_level,
              'depth', 0
            )
          ) as hierarchy
        FROM matches
        WHERE rn = 1
      `;

      const result = await pool.query<{
        idx: number;
        hierarchy: Array<{
          id: null;
          osm_id: number;
          name: string;
          admin_level: number;
          depth: number;
        }>;
      }>(query, [lons, lats]);

      const grouped: Record<number, HierarchyMatch> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, hierarchy: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy || [] };
      });

      res.json({
        count: points.length,
        results: Object.values(grouped),
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

// NORMAL: Direct hierarchy_boundaries lookup (no CTE, no fallback)
router.post(
  "/normal",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as {
        points: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);

      const query = `
        WITH points AS (
          SELECT (ordinality - 1) AS idx, lon, lat
          FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
        ),
        pts AS (
          SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
          FROM points
        ),
        deepest_match AS (
          SELECT 
            pts.idx,
            hb.id,
            hb.osm_id,
            hb.name,
            hb.admin_level,
            hb.depth,
            ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY hb.depth DESC) as rn
          FROM pts
          JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds, pts.g)
        )
        SELECT 
          idx,
          json_build_array(
            json_build_object(
              'id', id,
              'osm_id', osm_id,
              'name', name,
              'admin_level', admin_level,
              'depth', depth
            )
          ) as hierarchy
        FROM deepest_match
        WHERE rn = 1
      `;

      const result = await pool.query<{
        idx: number;
        hierarchy: Array<{
          id: number;
          osm_id: number;
          name: string;
          admin_level: number;
          depth: number;
        }>;
      }>(query, [lons, lats]);

      const grouped: Record<number, HierarchyMatch> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, hierarchy: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy || [] };
      });

      res.json({
        count: points.length,
        results: Object.values(grouped),
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

// CTE: Recursive CTE with full hierarchy path (with fallback)
router.post(
  "/cte",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as {
        points: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);

      // Pattern A: Single recursive CTE query to find all ancestors
      // Simpler approach: Use the ancestors array from the deepest boundary
      const query = `
        WITH points AS (
          SELECT (ordinality - 1) AS idx, lon, lat
          FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
        ),
        pts AS (
          SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
          FROM points
        ),
        deepest_match AS (
          SELECT 
            pts.idx,
            hb.id,
            hb.osm_id,
            hb.name,
            hb.admin_level,
            hb.depth,
            hb.ancestors,
            ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY hb.depth DESC) as rn
          FROM pts
          JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds, pts.g)
        )
        SELECT 
          dm.idx::int,
          json_agg(
            json_build_object(
              'id', hb.id,
              'osm_id', hb.osm_id,
              'name', hb.name,
              'admin_level', hb.admin_level,
              'depth', hb.depth
            ) ORDER BY hb.depth
          ) as hierarchy
        FROM deepest_match dm
        JOIN hierarchy_boundaries hb ON hb.id = ANY(dm.ancestors) OR hb.id = dm.id
        WHERE dm.rn = 1
        GROUP BY dm.idx
      `;

      const result = await pool.query<{
        idx: number;
        hierarchy: Array<{
          id: number;
          osm_id: number;
          name: string;
          admin_level: number;
          depth: number;
        }>;
      }>(query, [lons, lats]);

      const grouped: Record<number, HierarchyMatch> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, hierarchy: [] };
      }

      result.rows.forEach((row) => {
        grouped[row.idx] = { idx: row.idx, hierarchy: row.hierarchy || [] };
      });

      // Step 2: Fallback for unmatched points - search planet_osm_polygon
      const unmatchedIndices = Object.keys(grouped)
        .map(Number)
        .filter((i) => grouped[i].hierarchy.length === 0);

      if (unmatchedIndices.length > 0) {
        // Create arrays for unmatched points
        const unmatchedLons = unmatchedIndices.map((i) => lons[i]);
        const unmatchedLats = unmatchedIndices.map((i) => lats[i]);

        // Fallback query: find deepest admin boundary from planet_osm_polygon
        const fallbackQuery = `
          WITH points AS (
            SELECT (ordinality - 1) AS idx, lon, lat
            FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
          ),
          pts AS (
            SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
            FROM points
          ),
          matches AS (
            SELECT 
              pts.idx,
              pop.osm_id,
              pop.name,
              pop.admin_level::int,
              ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY pop.admin_level::int DESC) as rn
            FROM pts
            JOIN planet_osm_polygon pop ON ST_Contains(pop.way, pts.g)
            WHERE pop.admin_level IS NOT NULL
              AND pop.admin_level::int IN (2, 4, 6, 8, 9, 10)
          )
          SELECT 
            idx,
            json_build_array(
              json_build_object(
                'id', NULL,
                'osm_id', osm_id,
                'name', name,
                'admin_level', admin_level,
                'depth', 0
              )
            ) as hierarchy
          FROM matches
          WHERE rn = 1
        `;

        const fallbackResult = await pool.query<{
          idx: number;
          hierarchy: Array<{
            id: number | null;
            osm_id: number;
            name: string;
            admin_level: number;
            depth: number;
          }>;
        }>(fallbackQuery, [unmatchedLons, unmatchedLats]);

        // Add fallback results to grouped
        fallbackResult.rows.forEach((row) => {
          const originalIdx = unmatchedIndices[row.idx];
          grouped[originalIdx] = {
            idx: originalIdx,
            hierarchy: row.hierarchy || [],
          };
        });
      }

      res.json({
        count: points.length,
        results: Object.values(grouped),
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

// CTE+FALLBACK: Sequential with full ancestor hierarchy and fallback
router.post(
  "/cte-fallback",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { points } = req.body as {
        points: unknown;
      };

      validateBatchPayload(points);
      const { lons, lats } = parseCoordinates(points);

      // Step 1: Find deepest matching boundary for each point
      const findDeepestQuery = `
        WITH points AS (
          SELECT (ordinality - 1) AS idx, lon, lat
          FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
        ),
        pts AS (
          SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
          FROM points
        )
        SELECT 
          pts.idx,
          hb.id,
          hb.osm_id,
          hb.name,
          hb.admin_level,
          hb.depth,
          hb.ancestors
        FROM pts
        JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds, pts.g)
        WHERE (pts.idx, hb.depth) IN (
          SELECT pts.idx, MAX(hb.depth)
          FROM pts
          JOIN hierarchy_boundaries hb ON ST_Contains(hb.bounds, pts.g)
          GROUP BY pts.idx
        )
      `;

      const deepestResults = await pool.query<{
        idx: number;
        id: number;
        osm_id: number;
        name: string;
        admin_level: number;
        depth: number;
        ancestors: number[];
      }>(findDeepestQuery, [lons, lats]);

      // Step 2: For each deepest boundary, fetch ancestors using the ancestors array
      const grouped: Record<number, HierarchyMatch> = {};
      for (let i = 0; i < points.length; i++) {
        grouped[i] = { idx: i, hierarchy: [] };
      }

      // Collect unique ancestor IDs from all results
      const allAncestorIds = new Set<number>();
      const resultMap = new Map<
        number,
        {
          id: number;
          osm_id: number;
          name: string;
          admin_level: number;
          depth: number;
          ancestors: number[];
        }
      >();

      deepestResults.rows.forEach((row) => {
        resultMap.set(row.idx, row);
        if (row.ancestors) {
          row.ancestors.forEach((id) => allAncestorIds.add(id));
        }
        allAncestorIds.add(row.id); // Include the boundary itself
      });

      // Step 3: Fetch all ancestors in one query
      if (allAncestorIds.size > 0) {
        const ancestorIds = Array.from(allAncestorIds);
        const fetchAncestorsQuery = `
          SELECT id, osm_id, name, admin_level, depth
          FROM hierarchy_boundaries
          WHERE id = ANY($1::int[])
          ORDER BY depth
        `;

        const ancestorResults = await pool.query<{
          id: number;
          osm_id: number;
          name: string;
          admin_level: number;
          depth: number;
        }>(fetchAncestorsQuery, [ancestorIds]);

        // Build a map of all ancestors
        const ancestorMap = new Map<
          number,
          {
            id: number;
            osm_id: number;
            name: string;
            admin_level: number;
            depth: number;
          }
        >();

        ancestorResults.rows.forEach((row) => {
          ancestorMap.set(row.id, row);
        });

        // For each point, reconstruct hierarchy from ancestors array
        deepestResults.rows.forEach((row) => {
          const hierarchy: typeof grouped[number]["hierarchy"] = [];
          const seen = new Set<number>(); // Track unique boundary IDs

          if (row.ancestors) {
            row.ancestors.forEach((ancestorId) => {
              if (!seen.has(ancestorId)) {
                const ancestor = ancestorMap.get(ancestorId);
                if (ancestor) {
                  hierarchy.push(ancestor);
                  seen.add(ancestorId);
                }
              }
            });
          }

          // Add the boundary itself if not already present
          if (!seen.has(row.id)) {
            hierarchy.push({
              id: row.id,
              osm_id: row.osm_id,
              name: row.name,
              admin_level: row.admin_level,
              depth: row.depth,
            });
          }

          // Sort by depth
          hierarchy.sort((a, b) => a.depth - b.depth);
          grouped[row.idx] = { idx: row.idx, hierarchy };
        });
      }

      // Step 4: Fallback for unmatched points - search planet_osm_polygon
      const unmatchedIndices = Object.keys(grouped)
        .map(Number)
        .filter((i) => grouped[i].hierarchy.length === 0);

      if (unmatchedIndices.length > 0) {
        // Create arrays for unmatched points
        const unmatchedLons = unmatchedIndices.map((i) => lons[i]);
        const unmatchedLats = unmatchedIndices.map((i) => lats[i]);

        // Fallback query: find deepest admin boundary from planet_osm_polygon
        const fallbackQuery = `
          WITH points AS (
            SELECT (ordinality - 1) AS idx, lon, lat
            FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat)
          ),
          pts AS (
            SELECT idx, ST_Transform(ST_SetSRID(ST_Point(lon, lat), 4326), 3857) AS g
            FROM points
          ),
          matches AS (
            SELECT 
              pts.idx,
              pop.osm_id,
              pop.name,
              pop.admin_level::int,
              ROW_NUMBER() OVER (PARTITION BY pts.idx ORDER BY pop.admin_level::int DESC) as rn
            FROM pts
            JOIN planet_osm_polygon pop ON ST_Contains(pop.way, pts.g)
            WHERE pop.admin_level IS NOT NULL
              AND pop.admin_level::int IN (2, 4, 6, 8, 9, 10)
          )
          SELECT 
            idx,
            osm_id,
            name,
            admin_level
          FROM matches
          WHERE rn = 1
        `;

        const fallbackResult = await pool.query<{
          idx: number;
          osm_id: number;
          name: string;
          admin_level: number;
        }>(fallbackQuery, [unmatchedLons, unmatchedLats]);

        // Add fallback results to grouped
        fallbackResult.rows.forEach((row) => {
          const originalIdx = unmatchedIndices[row.idx];
          grouped[originalIdx] = {
            idx: originalIdx,
            hierarchy: [
              {
                id: null,
                osm_id: row.osm_id,
                name: row.name,
                admin_level: row.admin_level,
                depth: 0,
              },
            ],
          };
        });
      }

      res.json({
        count: points.length,
        results: Object.values(grouped),
      });
    } catch (error) {
      const message = formatError(error);
      res.status(400).json({ error: message });
    }
  })
);

// Simple endpoint: Get full hierarchy for a single boundary by ID
router.get(
  "/boundary/:id/hierarchy",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const boundaryId = parsePositiveInt(id, 1);

    const query = `
      WITH RECURSIVE hierarchy_path AS (
        SELECT id, osm_id, name, admin_level, depth, parent_id
        FROM hierarchy_boundaries
        WHERE id = $1
        
        UNION ALL
        
        SELECT hb.id, hb.osm_id, hb.name, hb.admin_level, hb.depth, hb.parent_id
        FROM hierarchy_boundaries hb
        JOIN hierarchy_path hp ON hb.id = hp.parent_id
      )
      SELECT 
        id, osm_id, name, admin_level, depth
      FROM hierarchy_path
      ORDER BY depth
    `;

    const result = await pool.query<{
      id: number;
      osm_id: number;
      name: string;
      admin_level: number;
      depth: number;
    }>(query, [boundaryId]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Boundary not found" });
      return;
    }

    res.json({
      boundary_id: boundaryId,
      hierarchy: result.rows,
    });
  })
);

export default router;
