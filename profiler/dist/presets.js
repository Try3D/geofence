import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
/**
 * Default preset for Geofence benchmarking
 * Includes standard mutators, services, and k6 configuration
 */
export const GEOFENCE_PRESETS = {
    mutators: {
        apiPool: {
            file: path.join(ROOT, "backend/src/db.ts"),
            regex: /max:\s*\d+/,
            replaceFn: (v) => `max: ${v}`,
        },
        pgPool: {
            file: path.join(ROOT, "pgbouncer.ini"),
            regex: /default_pool_size\s*=\s*\d+/,
            replaceFn: (v) => `default_pool_size = ${v}`,
        },
    },
    services: {
        pgbouncer: {
            type: "docker",
            name: "pgbouncer",
        },
        backend: {
            type: "process",
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
    },
};
//# sourceMappingURL=presets.js.map