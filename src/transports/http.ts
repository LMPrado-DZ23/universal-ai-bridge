import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { buildServer } from "../server.js";
import { checkOrigin, extractToken } from "../security/auth.js";
import { TokenStore } from "../security/tokens.js";
import { RateLimiter } from "../security/ratelimit.js";
import { JobManager } from "../jobs.js";
import { Watcher } from "../watch.js";
import { startAdmin } from "./admin.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;
const SWEEP_MS = 60 * 1000;

interface Entry {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

function clientIp(req: Request): string {
  return (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}

/** Garante o segredo do admin: usa BRIDGE_ADMIN_SECRET ou gera e grava (0600). */
function ensureAdminSecret(config: Config): string {
  if (process.env.BRIDGE_ADMIN_SECRET && process.env.BRIDGE_ADMIN_SECRET.length >= 16) {
    return process.env.BRIDGE_ADMIN_SECRET;
  }
  const secret = randomBytes(24).toString("hex");
  try {
    mkdirSync(config.dataDir, { recursive: true });
    const p = resolve(config.dataDir, "admin.secret");
    writeFileSync(p, secret, "utf8");
    try {
      chmodSync(p, 0o600);
    } catch {
      /* Windows ACL não é POSIX; ok */
    }
  } catch {
    /* se não puder gravar, o segredo ainda vive em memória nesta execução */
  }
  return secret;
}

export async function startHttp(config: Config): Promise<() => void> {
  if (!config.token) {
    process.stderr.write("[universal-ai-bridge] ERRO: BRIDGE_TOKEN não definido. HTTP recusa subir.\n");
    process.exit(1);
  }

  const app = express();
  app.use(express.json({ limit: "8mb" }));

  const tokens = new TokenStore(config.token);
  const limiter = new RateLimiter();
  const sessions: Record<string, Entry> = {};

  const closeAllSessions = () => {
    for (const sid of Object.keys(sessions)) {
      try {
        sessions[sid].transport.close();
      } catch {
        /* ignore */
      }
      delete sessions[sid];
    }
  };

  const touch = (sid: string) => {
    if (sessions[sid]) sessions[sid].lastSeen = Date.now();
  };

  // Rate limit + Origin + token para todo /mcp.
  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    const ip = clientIp(req);
    const rl = limiter.check(ip);
    if (!rl.ok) {
      if (rl.retryAfterMs) res.setHeader("Retry-After", Math.ceil(rl.retryAfterMs / 1000));
      res.status(429).json({ error: rl.reason ?? "Limite excedido" });
      return;
    }
    if (!checkOrigin(req, config)) {
      res.status(403).json({ error: "Origin não permitido" });
      return;
    }
    if (!tokens.matches(extractToken(req))) {
      limiter.recordAuthFailure(ip);
      res.status(401).json({ error: "Token ausente ou inválido" });
      return;
    }
    limiter.recordAuthSuccess(ip);
    next();
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && sessions[sessionId]) {
        transport = sessions[sessionId].transport;
        touch(sessionId);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        if (Object.keys(sessions).length >= config.maxSessions) {
          res.status(429).json({ error: "Limite de sessões atingido." });
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions[sid] = { transport, lastSeen: Date.now() };
          },
          enableDnsRebindingProtection: true,
          allowedOrigins: config.allowedOrigins,
          ...(config.allowedHosts.length > 0 ? { allowedHosts: config.allowedHosts } : {}),
        });
        transport.onclose = () => {
          if (transport.sessionId) delete sessions[transport.sessionId];
        };
        // Cada sessão recebe seu PRÓPRIO servidor (JobManager/Watcher/env
        // isolados) — uma sessão não enxerga jobs/watches de outra.
        const server = buildServer(config);
        await server.connect(transport);
      } else {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Sessão inválida." }, id: null });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      process.stderr.write(`[universal-ai-bridge] erro POST /mcp: ${String(err)}\n`);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Erro interno" }, id: null });
    }
  });

  const sessionRequest = async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !sessions[sessionId]) {
        res.status(400).send("Sessão inválida ou ausente");
        return;
      }
      touch(sessionId);
      await sessions[sessionId].transport.handleRequest(req, res);
    } catch (err) {
      process.stderr.write(`[universal-ai-bridge] erro ${req.method} /mcp: ${String(err)}\n`);
      if (!res.headersSent) res.status(500).send("Erro interno");
    }
  };
  app.get("/mcp", sessionRequest);
  app.delete("/mcp", sessionRequest);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [sid, entry] of Object.entries(sessions)) {
      if (now - entry.lastSeen > SESSION_IDLE_MS) {
        try {
          entry.transport.close();
        } catch {
          /* ignore */
        }
        delete sessions[sid];
      }
    }
  }, SWEEP_MS);
  (sweep as { unref?: () => void }).unref?.();

  const httpServer = app.listen(config.port, "127.0.0.1", () => {
    process.stderr.write(
      `[universal-ai-bridge] HTTP em http://127.0.0.1:${config.port}/mcp (loopback). ` +
        `modo=${config.mode} shell=${config.allowShell} docker=${config.allowDocker} maxSessions=${config.maxSessions}\n`
    );
  });
  httpServer.on("clientError", (_err, socket) => socket.writable && socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));

  // Plano de controle local (porta separada, não encaminhada pelo túnel).
  const adminSecret = ensureAdminSecret(config);
  const admin = startAdmin(config.adminPort, {
    adminSecret,
    tokenStore: tokens,
    onPanic: () => {
      JobManager.killAllEverywhere();
      Watcher.stopAllEverywhere();
      closeAllSessions();
      tokens.revoke();
    },
    onRevoke: () => {
      closeAllSessions();
      tokens.revoke();
    },
    status: () => ({ sessions: Object.keys(sessions).length, hasToken: tokens.hasToken() }),
  });

  return () => {
    clearInterval(sweep);
    closeAllSessions();
    httpServer.close();
    admin.close();
  };
}
