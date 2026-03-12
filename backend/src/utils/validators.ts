export function parseCoordinate(value: unknown, label: "lon" | "lat"): number {
  if (value === undefined) {
    throw new Error(`Missing query param: ${label}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: must be a number`);
  }
  return parsed;
}

const ALLOWED_TABLES = new Set([
  "planet_osm_polygon",
  "planet_osm_polygon_simple_10",
  "planet_osm_polygon_simple_100",
  "planet_osm_polygon_simple_500",
  "planet_osm_polygon_simple_1000",
]);

export function parseTable(value: unknown): string {
  if (value === undefined || value === "original") return "planet_osm_polygon";
  if (typeof value !== "string" || !ALLOWED_TABLES.has(value)) {
    throw new Error(
      `Invalid table. Allowed: original, simple_10, simple_100, simple_500, simple_1000`
    );
  }
  return value;
}

export function parsePositiveInt(
  value: unknown,
  fallback: number,
  max = 500
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid limit: must be a positive integer");
  }
  return Math.min(parsed, max);
}

export function parseCoordinates(
  points: unknown[]
): { lons: number[]; lats: number[] } {
  const lons: number[] = [];
  const lats: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as { lon?: unknown; lat?: unknown };
    const lon = Number(p?.lon);
    const lat = Number(p?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`Invalid coordinates at index ${i}`);
    }
    lons.push(lon);
    lats.push(lat);
  }
  return { lons, lats };
}

export function validateBatchPayload(
  points: unknown,
  maxSize = 1000
): asserts points is Array<unknown> {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error("points must be a non-empty array");
  }
  if (points.length > maxSize) {
    throw new Error(`points array exceeds maximum of ${maxSize}`);
  }
}
