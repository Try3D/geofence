export const FRANCE_BOUNDS = {
    minLon: -2.937207,
    maxLon: 7.016791,
    minLat: 43.238664,
    maxLat: 49.428801,
};
/**
 * Generate random points within geographic bounds
 */
export function randomPoints(n, bounds = FRANCE_BOUNDS) {
    return Array.from({ length: n }, () => ({
        lon: bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon),
        lat: bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat),
    }));
}
/**
 * Generate a single random point
 */
export function randomPoint(bounds = FRANCE_BOUNDS) {
    return randomPoints(1, bounds)[0];
}
/**
 * Sleep for milliseconds
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=utils.js.map