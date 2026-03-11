import { exec, execSync, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { sleep } from "./utils.js";
import type { MutatorDef, ServiceDef, K6Config } from "./presets.js";

const execAsync = promisify(exec);

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
  // Optional accuracy metrics (for geometry simplification benchmarks)
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
export class Benchmark {
  private config: BenchmarkConfig;
  private resultsDir: string;
  private results: BenchmarkResult[] = [];

  constructor(config: BenchmarkConfig) {
    this.config = config;
    this.resultsDir = config.resultsDir || path.join(process.cwd(), "benchmark-results", config.name);
  }

  /**
   * Run all experiments
   */
  async run(): Promise<BenchmarkResult[]> {
    fs.mkdirSync(this.resultsDir, { recursive: true });

    console.log(`\n${"=".repeat(70)}`);
    console.log(`  ${this.config.name}`);
    console.log(`${"=".repeat(70)}\n`);

    for (let i = 0; i < this.config.experiments.length; i++) {
      const exp = this.config.experiments[i];
      const label = exp.label || Object.entries(exp).map(([k, v]) => `${k}=${v}`).join(", ");

      console.log(`\n${"─".repeat(70)}`);
      console.log(`Experiment ${i + 1}/${this.config.experiments.length}: ${label}`);
      console.log(`${"─".repeat(70)}`);

      try {
        // 1. Run mutators
        if (this.config.mutators) {
          for (const [key, mutatorDef] of Object.entries(this.config.mutators)) {
            if (exp[key] !== undefined) {
              console.log(`  → mutate ${key} = ${exp[key]}`);
              await this.applyMutator(mutatorDef, exp[key]);
            }
          }
        }

        // 2. Restart services
        if (this.config.services) {
          await this.restartServices(this.config.services);
        }

        // 3. Run k6
        const metrics = await this.runK6(i + 1, exp);
        this.results.push({ experiment: exp, metrics });

        console.log(
          `  ✓ throughput=${metrics.throughput.toFixed(2)} req/s${
            metrics.pointLookups != null ? `, point_lookups=${metrics.pointLookups.toFixed(2)}/s` : ""
          }`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${message}`);
        this.results.push({ experiment: exp, error: message });
      }
    }

    // Write results
    await this.writeResults();

    return this.results;
  }

  /**
   * Apply a file regex mutator
   */
  private async applyMutator(mutator: MutatorDef, value: any): Promise<void> {
    const content = fs.readFileSync(mutator.file, "utf-8");
    const updated = content.replace(mutator.regex, mutator.replaceFn(value));
    fs.writeFileSync(mutator.file, updated, "utf-8");
  }

  /**
   * Restart services (docker + process)
   */
  private async restartServices(services: Record<string, ServiceDef>): Promise<void> {
    for (const [name, serviceDef] of Object.entries(services)) {
      if (serviceDef.type === "docker") {
        console.log(`  → restart ${name}`);
        await execAsync(`docker-compose restart ${serviceDef.name}`);
        await sleep(2000);
      }
    }

    // Restart process services (backend)
    const backend = services["backend"];
    if (backend?.type === "process") {
      console.log("  → kill backend");
      await this.killPort(backend.port);

      console.log("  → start backend");
      spawn(backend.cmd, backend.args, {
        cwd: backend.cwd,
        detached: true,
        stdio: "ignore",
      }).unref();

      if (backend.healthUrl) {
        console.log("  → waiting for backend health...");
        await this.waitForHealth(backend.healthUrl);
      }
    }
  }

  /**
   * Kill process on port (cross-platform)
   */
  private async killPort(port: number): Promise<void> {
    try {
      if (process.platform === "darwin") {
        execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: "ignore" });
      } else {
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      }
    } catch (_) {}
    await sleep(1000);
  }

  /**
   * Wait for health check endpoint
   */
  private async waitForHealth(url: string, timeout = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const { stdout } = await execAsync(`curl -sf ${url}`);
        const body = JSON.parse(stdout);
        if (body.ok) return;
      } catch (_) {}
      await sleep(500);
    }
    throw new Error(`Health check timed out: ${url}`);
  }

  /**
   * Run k6 benchmark for an experiment
   */
  private async runK6(expNum: number, exp: ExperimentConfig): Promise<BenchmarkMetrics> {
    const k6Config = this.config.k6 || {};
    const { scriptPath, targetUrl = "http://localhost:3000", method = "GET", duration = "60s" } = k6Config;

    if (!scriptPath) {
      throw new Error("k6.scriptPath is required");
    }

    // Build payload
    let body: string | undefined;
    if (k6Config.payload) {
      body = JSON.stringify(k6Config.payload(exp));
    }

    // Build env vars
    const envVars: Record<string, string> = {
      TARGET_URL: targetUrl,
      METHOD: method,
      DURATION: exp.duration || (duration as string),
      VUS: String(exp.vus || k6Config.vus || 10),
      BATCH_SIZE: String(exp.batchSize || 1),
      ...(body ? { BODY: body } : {}),
      ...(k6Config.extraEnv || {}),
      ...(exp.extraEnv || {}),
    };

    const testName = `exp-${expNum}`;
    const k6SummaryFile = path.join(this.resultsDir, `${testName}-summary.json`);
    const k6ResultFile = path.join(this.resultsDir, `${testName}-raw.json`);

    const envFlags = Object.entries(envVars)
      .map(([k, v]) => `--env ${k}=${JSON.stringify(v)}`)
      .join(" ");

    const k6Cmd = [
      "k6",
      "run",
      scriptPath,
      `--out json=${k6ResultFile}`,
      `--summary-export=${k6SummaryFile}`,
      envFlags,
    ].join(" ");

    console.log(
      `  → k6 run (${envVars.VUS} VUs, ${envVars.DURATION})`
    );

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("sh", ["-c", k6Cmd], { stdio: "inherit" });
      proc.on("close", (code) => {
        if (code === 0 || code === 99) resolve();
        else reject(new Error(`k6 exited with code ${code}`));
      });
      proc.on("error", reject);
    });

    return this.parseK6Summary(k6SummaryFile);
  }

  /**
   * Parse k6 summary.json output
   */
  private parseK6Summary(summaryFile: string): BenchmarkMetrics {
    const raw = JSON.parse(fs.readFileSync(summaryFile, "utf-8"));
    const m = raw.metrics;
    return {
      throughput: m.http_reqs?.rate ?? 0,
      pointLookups: m.point_lookups?.rate ?? null,
      avgLatency: m.http_req_duration?.avg ?? 0,
      p50Latency: m.http_req_duration?.med ?? 0,
      p95Latency: m.http_req_duration?.["p(95)"] ?? 0,
      p99Latency: m.http_req_duration?.["p(99)"] ?? 0,
      failureRate: m.http_req_failed?.value ?? 0,
      totalRequests: m.http_reqs?.count ?? 0,
    };
  }

  /**
   * Write results to JSON file
   */
  private async writeResults(): Promise<void> {
    const result = {
      timestamp: new Date().toISOString(),
      name: this.config.name,
      experiments: this.results,
    };

    const outputFile = path.join(this.resultsDir, "result.json");
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));

    // Print summary
    const successful = this.results.filter((r) => !r.error);
    if (successful.length > 0) {
      console.log("\n📈 Best results:");
      const metric = successful[0].metrics?.pointLookups != null ? "pointLookups" : "throughput";
      const label = metric === "pointLookups" ? "point-lookups/s" : "req/s";
      const best = successful.reduce((a, b) => {
        const aVal = a.metrics?.[metric as keyof BenchmarkMetrics] ?? 0;
        const bVal = b.metrics?.[metric as keyof BenchmarkMetrics] ?? 0;
        return (bVal as number) > (aVal as number) ? b : a;
      });
      const bestVal = best.metrics?.[metric as keyof BenchmarkMetrics] ?? 0;
      const bestLabel = best.experiment.label || Object.entries(best.experiment).map(([k, v]) => `${k}=${v}`).join(", ");
      console.log(`  ${label}: ${(bestVal as number).toFixed(2)} @ ${bestLabel}`);

      const fastest = successful.reduce((a, b) =>
        (b.metrics?.p95Latency ?? 0) < (a.metrics?.p95Latency ?? 0) ? b : a
      );
      const fastestLabel = fastest.experiment.label || Object.entries(fastest.experiment).map(([k, v]) => `${k}=${v}`).join(", ");
      console.log(`  best P95: ${(fastest.metrics?.p95Latency ?? 0).toFixed(0)}ms @ ${fastestLabel}`);
    }

    console.log(`\n✓ Results written to: ${outputFile}\n`);
  }
}

// Export utilities
export { randomPoints, randomPoint, FRANCE_BOUNDS, type GeoPoint, type GeoBounds } from "./utils.js";
export { GEOFENCE_PRESETS, type MutatorDef, type ServiceDef, type K6Config } from "./presets.js";
