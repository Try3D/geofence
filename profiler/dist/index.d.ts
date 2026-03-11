import type { MutatorDef, ServiceDef, K6Config } from "./presets.js";
export interface ExperimentConfig {
    label?: string;
    [key: string]: any;
}
export interface BenchmarkMetrics {
    throughput: number;
    pointLookups: number | null;
    avgLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    failureRate: number;
    totalRequests: number;
    precision?: number;
    recall?: number;
    f1?: number;
    perfectMatchPct?: number;
}
export interface BenchmarkResult {
    experiment: ExperimentConfig;
    metrics?: BenchmarkMetrics;
    error?: string;
}
export interface BenchmarkConfig {
    name: string;
    experiments: ExperimentConfig[];
    mutators?: Record<string, MutatorDef>;
    services?: Record<string, ServiceDef>;
    k6?: Partial<K6Config>;
    resultsDir?: string;
}
/**
 * Main Benchmark class - orchestrates experiments, mutations, service restarts, and k6 runs
 */
export declare class Benchmark {
    private config;
    private resultsDir;
    private results;
    constructor(config: BenchmarkConfig);
    /**
     * Run all experiments
     */
    run(): Promise<BenchmarkResult[]>;
    /**
     * Apply a file regex mutator
     */
    private applyMutator;
    /**
     * Restart services (docker + process)
     */
    private restartServices;
    /**
     * Kill process on port (cross-platform)
     */
    private killPort;
    /**
     * Wait for health check endpoint
     */
    private waitForHealth;
    /**
     * Run k6 benchmark for an experiment
     */
    private runK6;
    /**
     * Parse k6 summary.json output
     */
    private parseK6Summary;
    /**
     * Write results to JSON file
     */
    private writeResults;
}
export { randomPoints, randomPoint, FRANCE_BOUNDS, type GeoPoint, type GeoBounds } from "./utils.js";
export { GEOFENCE_PRESETS, type MutatorDef, type ServiceDef, type K6Config } from "./presets.js";
//# sourceMappingURL=index.d.ts.map