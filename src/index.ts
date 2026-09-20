#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";
import { JobManager } from "./jobs.js";

function parseTransport(): "stdio" | "http" {
  const idx = process.argv.indexOf("--transport");
  const val = idx >= 0 ? process.argv[idx + 1] : process.env.BRIDGE_TRANSPORT;
  return val === "http" ? "http" : "stdio";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const transport = parseTransport();

  let httpShutdown: (() => void) | undefined;
  if (transport === "http") {
    httpShutdown = await startHttp(config);
  } else {
    await startStdio(config);
  }

  // Desligamento de emergência: mata todos os jobs e fecha o HTTP.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[universal-ai-bridge] ${signal}: encerrando jobs e servidor…\n`);
    try {
      JobManager.killAllEverywhere();
    } catch {
      /* ignore */
    }
    httpShutdown?.();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Não deixa uma rejeição não tratada derrubar o processo silenciosamente.
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`[universal-ai-bridge] unhandledRejection: ${String(reason)}\n`);
  });
}

main().catch((err) => {
  process.stderr.write(`[universal-ai-bridge] fatal: ${String(err)}\n`);
  process.exit(1);
});
