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
export declare const FRANCE_BOUNDS: GeoBounds;
/**
 * Generate random points within geographic bounds
 */
export declare function randomPoints(n: number, bounds?: GeoBounds): GeoPoint[];
/**
 * Generate a single random point
 */
export declare function randomPoint(bounds?: GeoBounds): GeoPoint;
/**
 * Sleep for milliseconds
 */
export declare function sleep(ms: number): Promise<void>;
//# sourceMappingURL=utils.d.ts.map