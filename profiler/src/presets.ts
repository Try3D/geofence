import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

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
export const GEOFENCE_PRESETS = {
  mutators: {
    apiPool: {
      file: path.join(ROOT, "backend/src/db.ts"),
      regex: /max:\s*\d+/,
      replaceFn: (v: number) => `max: ${v}`,
    },
    pgPool: {
      file: path.join(ROOT, "pgbouncer.ini"),
      regex: /default_pool_size\s*=\s*\d+/,
      replaceFn: (v: number) => `default_pool_size = ${v}`,
    },
  },

  services: {
    pgbouncer: {
      type: "docker" as const,
      name: "pgbouncer",
    },
    backend: {
      type: "process" as const,
      port: 3000,
      cmd: "npm",
      args: ["run", "dev"],
      cwd: path.join(ROOT, "backend"),
      healthUrl: "http://localhost:3000/health",
    },
  },

  k6: {
    scriptPath: path.join(__dirname, "../k6-runner.js"),
    targetUrl: "http://localhost:3000/api/polygons/batch",
    method: "POST",
    duration: "60s",
    vus: 10,
  } as K6Config,
};
