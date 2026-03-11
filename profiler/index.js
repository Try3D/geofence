#!/usr/bin/env node

import { exec, execSync, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

// ─── Built-in mutators ────────────────────────────────────────────────────────

export function fileRegexMutator(filePath, regex, replacement) {
  return (value) => {
    const content = fs.readFileSync(filePath, { encoding: "utf-8" });
    const updated = content.replace(regex, replacement(value));
    fs.writeFileSync(filePath, updated, { encoding: "utf-8" });
  };
}

export function dockerServiceRestarter(serviceName, cwd = process.cwd()) {
  return async () => {
    await execAsync(`docker-compose restart ${serviceName}`, { cwd });
    await sleep(2000);
  };
}

export function portKiller(port) {
  return async () => {
    try {
      if (process.platform === "darwin") {
        execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: "ignore" });
      } else {
        execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      }
    } catch (_) {}
    await sleep(1000);
  };
}

export function processSpawner(cmd, args, cwd) {
  return () => {
    spawn(cmd, args, { cwd, detached: true, stdio: "ignore" }).unref();
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url, timeout = 30000) {
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

function parseK6Summary(summaryFile) {
  const raw = JSON.parse(fs.readFileSync(summaryFile, { encoding: "utf-8" }));
  const m = raw.metrics;
  return {
    throughput:    m.http_reqs?.rate                  ?? 0,
    pointLookups:  m.point_lookups?.rate              ?? null,
    avgLatency:    m.http_req_duration?.avg           ?? 0,
    p50Latency:    m.http_req_duration?.med           ?? 0,
    p95Latency:    m.http_req_duration?.["p(95)"]     ?? 0,
    p99Latency:    m.http_req_duration?.["p(99)"]     ?? 0,
    failureRate:   m.http_req_failed?.value           ?? 0,
    totalRequests: m.http_reqs?.count                 ?? 0,
  };
}

function formatTable(results, config) {
  const hasLabel = config.experiments.every((e) => e.label);
  const experimentKeys = hasLabel
    ? ["label"]
    : Object.keys(config.experiments[0]).filter(
        (k) => k !== "label" && k !== "extraEnv"
      );
  const metricKeys = config.metrics ?? [
    "throughput", "pointLookups", "avgLatency", "p95Latency", "p99Latency", "failureRate", "totalRequests",
  ];

  const metricLabels = {
    throughput:    "Req/s",
    pointLookups:  "Pts/s",
    avgLatency:    "Avg Lat",
    p50Latency:    "P50",
    p95Latency:    "P95",
    p99Latency:    "P99",
    failureRate:   "Failures",
    totalRequests: "Total Reqs",
  };

  const headers = [
    ...experimentKeys,
    ...metricKeys.map((k) => metricLabels[k] ?? k),
  ];

  const rows = results.map((r) => {
    const expCells = experimentKeys.map((k) => String(r.experiment?.[k] ?? ""));
    const metricCells = metricKeys.map((k) => {
      if (r.error) return "ERROR";
      const v = r[k];
      if (v == null) return "-";
      if (k === "throughput" || k === "pointLookups") return v.toFixed(2);
      if (k === "failureRate") return `${(v * 100).toFixed(1)}%`;
      if (k.includes("Latency") || k.includes("Lat")) return `${v.toFixed(0)}ms`;
      return String(v);
    });
    return [...expCells, ...metricCells];
  });

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  let out = headers.map((h, i) => h.padEnd(widths[i])).join(" │ ") + "\n";
  out += widths.map((w) => "─".repeat(w)).join("─┼─") + "\n";
  rows.forEach((row) => {
    out += row.map((cell, i) => cell.padEnd(widths[i])).join(" │ ") + "\n";
  });
  return out;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export async function runProfiler(config) {
  const {
    name = "Profiler",
    resultsDir = "./profiler-results",
    experiments,
    mutators = {},
    services = {},
    k6,
  } = config;

  if (!experiments?.length) throw new Error("No experiments defined");
  if (!k6?.scriptPath) throw new Error("k6.scriptPath is required");

  fs.mkdirSync(resultsDir, { recursive: true });

  const outputFile  = path.join(resultsDir, "results.json");
  const summaryFile = path.join(resultsDir, "summary.txt");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${"=".repeat(60)}\n`);

  const results = [];

  for (let i = 0; i < experiments.length; i++) {
    const exp = experiments[i];
    const label = exp.label ?? Object.entries(exp).map(([k, v]) => `${k}=${v}`).join(", ");

    console.log(`\n${"─".repeat(60)}`);
    console.log(`Experiment ${i + 1}/${experiments.length}: ${label}`);
    console.log(`${"─".repeat(60)}`);

    try {
      // 1. Run mutators for changed dimensions
      for (const [key, mutatorFn] of Object.entries(mutators)) {
        if (exp[key] !== undefined) {
          console.log(`  → mutate ${key} = ${exp[key]}`);
          await mutatorFn(exp[key], exp);
        }
      }

      // 2. Restart services
      if (services.pgbouncer?.restartFn) {
        console.log("  → restart pgbouncer");
        await services.pgbouncer.restartFn();
      }
      if (services.backend) {
        const { port, killFn, startFn, healthUrl } = services.backend;
        if (killFn) { console.log("  → kill backend"); await killFn(); }
        if (startFn) { console.log("  → start backend"); await startFn(); }
        if (healthUrl) {
          console.log("  → waiting for backend health...");
          await waitForHealth(healthUrl);
        }
      }

      // 3. Build k6 env vars from experiment + k6 config
      const body = k6.buildPayload ? k6.buildPayload(exp) : undefined;
      const envVars = {
        TARGET_URL:  k6.targetUrl,
        METHOD:      k6.method ?? "GET",
        DURATION:    exp.duration ?? k6.duration ?? "60s",
        VUS:         String(exp.vus ?? k6.vus ?? 10),
        BATCH_SIZE:  String(exp.batchSize ?? 1),
        ...(body ? { BODY: body } : {}),
        ...(k6.extraEnv ?? {}),
        ...(exp.extraEnv ?? {}),
      };

      const testName = `exp-${i + 1}`;
      const k6SummaryFile = path.join(resultsDir, `${testName}-summary.json`);
      const k6ResultFile  = path.join(resultsDir, `${testName}-raw.json`);

      const envFlags = Object.entries(envVars)
        .map(([k, v]) => `--env ${k}=${JSON.stringify(v)}`)
        .join(" ");

      const k6Cmd = [
        "k6", "run",
        k6.scriptPath,
        `--out json=${k6ResultFile}`,
        `--summary-export=${k6SummaryFile}`,
        envFlags,
      ].join(" ");

      console.log(`  → k6 run (${exp.vus ?? k6.vus} VUs, ${exp.duration ?? k6.duration ?? "60s"})`);

      await new Promise((resolve, reject) => {
        const proc = spawn("sh", ["-c", k6Cmd], { stdio: "inherit" });
        proc.on("close", (code) => {
          if (code === 0 || code === 99) resolve();
          else reject(new Error(`k6 exited with code ${code}`));
        });
        proc.on("error", reject);
      });

      const metrics = parseK6Summary(k6SummaryFile);
      results.push({ experiment: exp, ...metrics });
      console.log(`  ✓ throughput=${metrics.throughput.toFixed(2)} req/s${metrics.pointLookups != null ? `, point_lookups=${metrics.pointLookups.toFixed(2)}/s` : ""}`);

    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      results.push({ experiment: exp, error: err.message });
    }
  }

  // ─── Results ────────────────────────────────────────────────────────────────

  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  const table = formatTable(results, config);
  const summary =
    `${name} — Results\n` +
    "=".repeat(60) + "\n\n" +
    table + "\n" +
    "=".repeat(60) + "\n" +
    `Full results: ${outputFile}`;

  fs.writeFileSync(summaryFile, summary);

  console.log(`\n\n${summary}`);

  // Best per metric
  const successful = results.filter((r) => !r.error);
  if (successful.length > 0) {
    console.log("\n📈 Best results:");
    const metric = successful[0].pointLookups != null ? "pointLookups" : "throughput";
    const label  = metric === "pointLookups" ? "point-lookups/s" : "req/s";
    const best   = successful.reduce((a, b) => (b[metric] > a[metric] ? b : a));
    const bestLabel = Object.entries(best.experiment).map(([k, v]) => `${k}=${v}`).join(", ");
    console.log(`  ${label}: ${best[metric].toFixed(2)} @ ${bestLabel}`);

    const fastest = successful.reduce((a, b) => (b.p95Latency < a.p95Latency ? b : a));
    const fastestLabel = Object.entries(fastest.experiment).map(([k, v]) => `${k}=${v}`).join(", ");
    console.log(`  best P95: ${fastest.p95Latency.toFixed(0)}ms @ ${fastestLabel}`);
  }

  return results;
}
