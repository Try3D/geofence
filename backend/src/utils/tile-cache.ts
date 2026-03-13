const geohash = require("geohash") as any;
import * as h3 from "h3-js";
const qk = require("quadkey") as any;

export interface CacheEntry {
  polygonIds: string[];
  lat: number;
  lon: number;
  timestamp: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  exactMatches: number;
  proximityMatches: number;
  accuracy: number; // % of proximity matches that were correct
  memoryMB: number;
}

/**
 * LRU Cache with memory limit (8GB max, configurable)
 */
export class TileCache {
  private cache: Map<string, CacheEntry>;
  private lruOrder: string[] = [];
  private maxMemoryMB: number;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    exactMatches: 0,
    proximityMatches: 0,
    accuracy: 0,
    memoryMB: 0,
  };

  constructor(maxMemoryMB: number = 1024) {
    this.cache = new Map();
    this.maxMemoryMB = maxMemoryMB;
  }

  /**
   * Estimate memory usage of a cache entry (rough estimate)
   */
  private estimateEntrySize(entry: CacheEntry): number {
    return (
      entry.polygonIds.reduce((sum, id) => sum + id.length, 0) + 100 // rough estimate
    );
  }

  /**
   * Get total memory used by cache in MB
   */
  private getCurrentMemoryMB(): number {
    let totalBytes = 0;
    for (const entry of this.cache.values()) {
      totalBytes += this.estimateEntrySize(entry);
    }
    return totalBytes / (1024 * 1024);
  }

  /**
   * Evict least recently used entry if memory threshold exceeded
   */
  private evictIfNeeded(): void {
    const currentMB = this.getCurrentMemoryMB();
    if (currentMB > this.maxMemoryMB && this.lruOrder.length > 0) {
      const lruKey = this.lruOrder.shift();
      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }
  }

  /**
   * Store result in cache
   */
  set(key: string, polygonIds: string[], lat: number, lon: number): void {
    const entry: CacheEntry = {
      polygonIds,
      lat,
      lon,
      timestamp: Date.now(),
    };

    // Update LRU order
    const index = this.lruOrder.indexOf(key);
    if (index > -1) {
      this.lruOrder.splice(index, 1);
    }
    this.lruOrder.push(key);

    this.cache.set(key, entry);
    this.evictIfNeeded();
  }

  /**
   * Get exact tile match
   */
  getExact(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      this.stats.hits++;
      this.stats.exactMatches++;
      // Update LRU
      const index = this.lruOrder.indexOf(key);
      if (index > -1) {
        this.lruOrder.splice(index, 1);
        this.lruOrder.push(key);
      }
    }
    return entry;
  }

  /**
   * Find CLOSEST nearby cached tile within distance threshold
   * Returns the nearest entry if found, undefined otherwise
   */
  getProximity(lat: number, lon: number, distanceM: number): CacheEntry | undefined {
    let bestEntry: CacheEntry | undefined;
    let bestKey: string | undefined;
    let bestDist = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      const distance = this.haversineDistance(lat, lon, entry.lat, entry.lon);
      if (distance <= distanceM && distance < bestDist) {
        bestEntry = entry;
        bestKey = key;
        bestDist = distance;
      }
    }

    if (bestEntry && bestKey) {
      this.stats.hits++;
      this.stats.proximityMatches++;
      // Update LRU
      const index = this.lruOrder.indexOf(bestKey);
      if (index > -1) {
        this.lruOrder.splice(index, 1);
        this.lruOrder.push(bestKey);
      }
      return bestEntry;
    }

    return undefined;
  }

  /**
   * Record a miss
   */
  recordMiss(): void {
    this.stats.misses++;
  }

  /**
   * Record accuracy of proximity match (was it correct?)
   */
  recordProximityAccuracy(correct: boolean): void {
    if (this.stats.proximityMatches > 0) {
      const correctMatches = Math.round(
        this.stats.accuracy * (this.stats.proximityMatches - 1) / 100
      );
      this.stats.accuracy = (correctMatches + (correct ? 1 : 0)) / this.stats.proximityMatches * 100;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      memoryMB: this.getCurrentMemoryMB(),
    };
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.lruOrder = [];
  }

  /**
   * Get all cache entries (for proximity searches)
   */
  getEntries(): IterableIterator<[string, CacheEntry]> {
    return this.cache.entries();
  }

  /**
   * Haversine distance between two points (meters)
   */
  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

/**
 * Geohash tile system
 */
export class GeohashTileSystem {
  private cache: TileCache;
  private precision: number;

  constructor(precision: number = 7, maxMemoryMB?: number) {
    this.precision = precision;
    this.cache = new TileCache(maxMemoryMB);
  }

  getEntries(): IterableIterator<[string, CacheEntry]> {
    return this.cache.getEntries();
  }

  getTile(lat: number, lon: number): string {
    return geohash.GeoHash.encodeGeoHash(lat, lon, this.precision);
  }

  get(lat: number, lon: number): { hit: boolean; entry?: CacheEntry } {
    const tile = this.getTile(lat, lon);
    const exact = this.cache.getExact(tile);
    if (exact) {
      return { hit: true, entry: exact };
    }

    this.cache.recordMiss();
    return { hit: false };
  }

  getProximity(lat: number, lon: number, distanceM: number): { hit: boolean; entry?: CacheEntry } {
    const entry = this.cache.getProximity(lat, lon, distanceM);
    if (entry) {
      return { hit: true, entry };
    }
    return { hit: false };
  }

  set(lat: number, lon: number, polygonIds: string[]): void {
    const tile = this.getTile(lat, lon);
    this.cache.set(tile, polygonIds, lat, lon);
  }

  getStats(): CacheStats {
    return this.cache.getStats();
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * H3 tile system
 */
export class H3TileSystem {
  private cache: TileCache;
  private resolution: number;

  constructor(resolution: number = 8, maxMemoryMB?: number) {
    this.resolution = resolution;
    this.cache = new TileCache(maxMemoryMB);
  }

  getEntries(): IterableIterator<[string, CacheEntry]> {
    return this.cache.getEntries();
  }

  getTile(lat: number, lon: number): string {
    return h3.latLngToCell(lat, lon, this.resolution);
  }

  get(lat: number, lon: number): { hit: boolean; entry?: CacheEntry } {
    const tile = this.getTile(lat, lon);
    const exact = this.cache.getExact(tile);
    if (exact) {
      return { hit: true, entry: exact };
    }

    this.cache.recordMiss();
    return { hit: false };
  }

  getProximity(lat: number, lon: number, distanceM: number): { hit: boolean; entry?: CacheEntry } {
    const entry = this.cache.getProximity(lat, lon, distanceM);
    if (entry) {
      return { hit: true, entry };
    }
    return { hit: false };
  }

  set(lat: number, lon: number, polygonIds: string[]): void {
    const tile = this.getTile(lat, lon);
    this.cache.set(tile, polygonIds, lat, lon);
  }

  getStats(): CacheStats {
    return this.cache.getStats();
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Quadkey tile system
 */
export class QuadkeyTileSystem {
  private cache: TileCache;
  private zoom: number;

  constructor(zoom: number = 14, maxMemoryMB?: number) {
    this.zoom = zoom;
    this.cache = new TileCache(maxMemoryMB);
  }

  getEntries(): IterableIterator<[string, CacheEntry]> {
    return this.cache.getEntries();
  }

  getTile(lat: number, lon: number): string {
    return qk.toQuaKey(lat, lon, this.zoom);
  }

  get(lat: number, lon: number): { hit: boolean; entry?: CacheEntry } {
    const tile = this.getTile(lat, lon);
    const exact = this.cache.getExact(tile);
    if (exact) {
      return { hit: true, entry: exact };
    }

    this.cache.recordMiss();
    return { hit: false };
  }

  getProximity(lat: number, lon: number, distanceM: number): { hit: boolean; entry?: CacheEntry } {
    const entry = this.cache.getProximity(lat, lon, distanceM);
    if (entry) {
      return { hit: true, entry };
    }
    return { hit: false };
  }

  set(lat: number, lon: number, polygonIds: string[]): void {
    const tile = this.getTile(lat, lon);
    this.cache.set(tile, polygonIds, lat, lon);
  }

  getStats(): CacheStats {
    return this.cache.getStats();
  }

  clear(): void {
    this.cache.clear();
  }
}
