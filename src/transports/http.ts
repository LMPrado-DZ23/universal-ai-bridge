import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { buildServer } from "../server.js";
import { checkToken, checkOrigin } from "../security/auth.js";

const SESSION_IDLE_MS = 30 * 60 * 1000; // expira sessão ociosa em 30 min
const SWEEP_MS = 60 * 1000;

interface Entry {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

/**
 * Transporte Streamable HTTP: para IAs no navegador (ChatGPT, Claude.ai) via
 * túnel HTTPS. Protegido por token Bearer + checagem de Origin. Sessões ociosas
 * expiram e são limpas. Erros de rede/desconexão não derrubam o processo.
 */
export async function startHttp(config: Config): Promise<() => void> {
  if (!config.token) {
    process.stderr.write(
      "[universal-ai-bridge] ERRO: BRIDGE_TOKEN não definido. O transporte HTTP recusa subir sem token.\n"
    );
    process.exit(1);
  }

  const app = express();
  app.use(express.json({ limit: "8mb" }));

  const sessions: Record<string, Entry> = {};

  const touch = (sid: string) => {
    if (sessions[sid]) sessions[sid].lastSeen = Date.now();
  };

  // Middleware de segurança para todo /mcp.
  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (!checkOrigin(req, config)) {
      res.status(403).json({ error: "Origin não permitido" });
      return;
    }
    if (!checkToken(req, config)) {
      res.status(401).json({ error: "Token ausente ou inválido" });
      return;
    }
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
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions[sid] = { transport, lastSeen: Date.now() };
          },
          enableDnsRebindingProtection: true,
          allowedOrigins: config.allowedOrigins,
          // Só restringe Host quando configurado (ex.: host do túnel). Vazio =
          // não restringe (loopback/local funciona sem configurar nada).
          ...(config.allowedHosts.length > 0 ? { allowedHosts: config.allowedHosts } : {}),
        });
        transport.onclose = () => {
          if (transport.sessionId) delete sessions[transport.sessionId];
        };
        const server = buildServer(config);
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Sessão inválida: falta initialize." },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      process.stderr.write(`[universal-ai-bridge] erro no POST /mcp: ${String(err)}\n`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Erro interno" },
          id: null,
        });
      }
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
      process.stderr.write(`[universal-ai-bridge] erro em ${req.method} /mcp: ${String(err)}\n`);
      if (!res.headersSent) res.status(500).send("Erro interno");
    }
  };

  app.get("/mcp", sessionRequest);
  app.delete("/mcp", sessionRequest);

  // /health NÃO revela caminhos locais.
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Varredura de sessões ociosas.
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
  sweep.unref?.();

  // Escuta SOMENTE em loopback: o túnel (cloudflared) faz a ponte externa.
  const httpServer = app.listen(config.port, "127.0.0.1", () => {
    process.stderr.write(
      `[universal-ai-bridge] HTTP pronto em http://127.0.0.1:${config.port}/mcp (loopback). ` +
        `modo=${config.mode} shell=${config.allowShell} docker=${config.allowDocker}\n`
    );
  });
  httpServer.on("clientError", (_err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  // Função de desligamento limpo.
  return () => {
    clearInterval(sweep);
    for (const sid of Object.keys(sessions)) {
      try {
        sessions[sid].transport.close();
      } catch {
        /* ignore */
      }
      delete sessions[sid];
    }
    httpServer.close();
  };
}
