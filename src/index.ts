#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";

function parseTransport(): "stdio" | "http" {
  const idx = process.argv.indexOf("--transport");
  const val = idx >= 0 ? process.argv[idx + 1] : process.env.BRIDGE_TRANSPORT;
  return val === "http" ? "http" : "stdio";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const transport = parseTransport();
  if (transport === "http") {
    await startHttp(config);
  } else {
    await startStdio(config);
  }
}

main().catch((err) => {
  process.stderr.write(`[universal-ai-bridge] fatal: ${String(err)}\n`);
  process.exit(1);
});
