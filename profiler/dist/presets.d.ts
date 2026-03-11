export interface MutatorDef {
    file: string;
    regex: RegExp;
    replaceFn: (value: any) => string;
}
export interface ServiceDef {
    type: "docker" | "port" | "process";
    [key: string]: any;
}
export interface K6Config {
    scriptPath: string;
    targetUrl: string;
    method?: string;
    duration?: string;
    vus?: number;
    payload?: (exp: any) => object;
    extraEnv?: Record<string, string>;
}
/**
 * Default preset for Geofence benchmarking
 * Includes standard mutators, services, and k6 configuration
 */
export declare const GEOFENCE_PRESETS: {
    mutators: {
        apiPool: {
            file: string;
            regex: RegExp;
            replaceFn: (v: number) => string;
        };
        pgPool: {
            file: string;
            regex: RegExp;
            replaceFn: (v: number) => string;
        };
    };
    services: {
        pgbouncer: {
            type: "docker";
            name: string;
        };
        backend: {
            type: "process";
            port: number;
            cmd: string;
            args: string[];
            cwd: string;
            healthUrl: string;
        };
    };
    k6: K6Config;
};
//# sourceMappingURL=presets.d.ts.map