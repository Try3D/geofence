#!/usr/bin/env node
"use strict";
/**
 * Benchmarks connection pool size configurations for the geofence API.
 * Tests various API pool sizes and PgBouncer pool sizes in combination.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var path_1 = __importDefault(require("path"));
var url_1 = require("url");
var profiler_1 = require("@geofence/profiler");
var __dirname = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
var ROOT = path_1.default.join(__dirname, "../..");
var bench = new profiler_1.Benchmark(__assign(__assign({ name: "Connection Pool Size Optimization", resultsDir: path_1.default.join(ROOT, "benchmark-results", "01_connection_pooling") }, profiler_1.GEOFENCE_PRESETS), { experiments: [
        // ── Varying API pool sizes ────────────────────────────────────────────────
        {
            label: "API pool=10, PG pool=20",
            apiPool: 10,
            pgPool: 20,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: [], limit: 20 }),
            },
        },
        {
            label: "API pool=15, PG pool=25",
            apiPool: 15,
            pgPool: 25,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: [], limit: 20 }),
            },
        },
        {
            label: "API pool=20, PG pool=25",
            apiPool: 20,
            pgPool: 25,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: [], limit: 20 }),
            },
        },
        {
            label: "API pool=25, PG pool=25",
            apiPool: 25,
            pgPool: 25,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: [], limit: 20 }),
            },
        },
        {
            label: "API pool=30, PG pool=25",
            apiPool: 30,
            pgPool: 25,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: [], limit: 20 }),
            },
        },
        {
            label: "API pool=35, PG pool=25",
            apiPool: 35,
            pgPool: 25,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: [], limit: 20 }),
            },
        },
        {
            label: "API pool=40, PG pool=25",
            apiPool: 40,
            pgPool: 25,
            extraEnv: {
                METHOD: "POST",
                TARGET_URL: "http://localhost:3000/api/polygons/batch",
                BODY: JSON.stringify({ points: [], limit: 20 }),
            },
        },
    ] }));
await bench.run();
