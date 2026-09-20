import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { PolicyEngine } from "./policy/engine.js";
import { ConfirmStore } from "./confirm.js";
import { Audit } from "./audit/log.js";
import { JobManager } from "./jobs.js";
import { Watcher } from "./watch.js";
import { PtyManager } from "./pty.js";
import { registerTools } from "./tools/index.js";

/**
 * Recursos de UMA sessão. `dispose()` é idempotente e encerra apenas os
 * recursos desta sessão (jobs, PTYs, watchers, confirmações, env), removendo
 * os managers dos registros estáticos globais para não vazar memória.
 */
export class SessionResources {
  private disposed = false;
  readonly jobs: JobManager;
  readonly watcher: Watcher;
  readonly pty: PtyManager;
  readonly confirm: ConfirmStore;
  readonly sessionEnv: Record<string, string> = {};

  constructor(maxBufferBytes: number) {
    this.jobs = new JobManager(maxBufferBytes);
    this.watcher = new Watcher();
    this.pty = new PtyManager(maxBufferBytes);
    this.confirm = new ConfirmStore();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.jobs.destroy(); } catch { /* ignore */ }
    try { this.pty.destroy(); } catch { /* ignore */ }
    try { this.watcher.destroy(); } catch { /* ignore */ }
    try { this.confirm.clear(); } catch { /* ignore */ }
    for (const k of Object.keys(this.sessionEnv)) delete this.sessionEnv[k];
  }
}

/** Fábrica: monta um McpServer novo + os recursos da sessão. */
export function buildServer(config: Config): { server: McpServer; resources: SessionResources } {
  const server = new McpServer({ name: "universal-ai-bridge", version: "0.6.1" });
  const resources = new SessionResources(config.policy.shell.maxOutputBytes);

  registerTools(server, {
    config,
    policy: new PolicyEngine(config.policy),
    confirm: resources.confirm,
    audit: new Audit(config.auditDir),
    jobs: resources.jobs,
    watcher: resources.watcher,
    pty: resources.pty,
    sessionEnv: resources.sessionEnv,
  });

  return { server, resources };
}
