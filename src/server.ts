import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_LIMITS, type ResourceLimits, type Config } from "./config.js";
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
  readonly abort = new AbortController();
  readonly jobs: JobManager;
  readonly watcher: Watcher;
  readonly pty: PtyManager;
  readonly confirm: ConfirmStore;
  readonly sessionEnv: Record<string, string> = Object.create(null);

  constructor(maxBufferBytes: number, limits: ResourceLimits = DEFAULT_LIMITS) {
    this.jobs = new JobManager(maxBufferBytes, limits);
    this.watcher = new Watcher(limits.watchers);
    this.pty = new PtyManager(maxBufferBytes, limits);
    this.confirm = new ConfirmStore(limits.confirmations, limits.confirmationTtlMs);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    try { this.jobs.destroy(); } catch { /* ignore */ }
    try { this.pty.destroy(); } catch { /* ignore */ }
    try { this.watcher.destroy(); } catch { /* ignore */ }
    try { this.confirm.clear(); } catch { /* ignore */ }
    for (const k of Object.keys(this.sessionEnv)) delete this.sessionEnv[k];
  }
}

/** Fábrica: monta um McpServer novo + os recursos da sessão. */
export function buildServer(config: Config): { server: McpServer; resources: SessionResources } {
  const server = new McpServer({ name: "universal-ai-bridge", version: "0.7.0" });
  const resources = new SessionResources(config.policy.shell.maxOutputBytes, config.limits);

  registerTools(server, {
    config,
    policy: new PolicyEngine(structuredClone(config.policy)),
    confirm: resources.confirm,
    audit: new Audit(config.auditDir, config.auditRequired),
    jobs: resources.jobs,
    watcher: resources.watcher,
    pty: resources.pty,
    sessionEnv: resources.sessionEnv,
    isDisposed: () => resources.isDisposed,
    signal: resources.abort.signal,
  });

  return { server, resources };
}
