export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface GeoBounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export const FRANCE_BOUNDS: GeoBounds = {
  minLon: -2.937207,
  maxLon: 7.016791,
  minLat: 43.238664,
  maxLat: 49.428801,
};

/**
 * Generate random points within geographic bounds
 */
export function randomPoints(n: number, bounds: GeoBounds = FRANCE_BOUNDS): GeoPoint[] {
  return Array.from({ length: n }, () => ({
    lon: bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon),
    lat: bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat),
  }));
}

/**
 * Generate a single random point
 */
export function randomPoint(bounds: GeoBounds = FRANCE_BOUNDS): GeoPoint {
  return randomPoints(1, bounds)[0];
}

/**
 * Sleep for milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
