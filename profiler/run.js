#!/usr/bin/env node

import { pathToFileURL } from "url";
import path from "path";
import { runProfiler } from "./index.js";

const args = process.argv.slice(2);
const configFlag = args.indexOf("--config");
const configPath =
  configFlag !== -1
    ? path.resolve(args[configFlag + 1])
    : new URL("./geofence.config.js", import.meta.url).pathname;

const { default: config } = await import(pathToFileURL(configPath).href);

await runProfiler(config);
