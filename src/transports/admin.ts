import { ConfirmStore } from "../confirm.js";
import express, { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { TokenStore } from "../security/tokens.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface AdminDeps {
  adminSecret: string;
  tokenStore: TokenStore;
  onPanic: () => void; // mata jobs/watches, fecha sessões, revoga token
  onRevoke: () => void; // fecha sessões e revoga token (servidor segue de pé)
  status: () => { sessions: number; hasToken: boolean };
}

/**
 * Plano de controle LOCAL numa porta separada (loopback), NÃO encaminhada pelo
 * túnel. Exige o segredo de admin (arquivo local). Serve como parada de
 * emergência e rotação de token sem editar o .env à mão.
 */
export function startAdmin(port: number, deps: AdminDeps): { close: () => void } {
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const provided = req.header("x-admin-secret") ?? "";
    if (!safeEqual(provided, deps.adminSecret)) {
      res.status(401).json({ error: "admin secret inválido" });
      return;
    }
    next();
  });

  app.get('/admin/approvals', (_req,res) => {res.setHeader('Cache-Control','no-store');res.json(ConfirmStore.listHuman());});
  app.post('/admin/approvals/:id', (req,res) => {
    if (typeof req.body?.approve !== 'boolean') {res.status(400).json({error:'approve deve ser boolean'});return;}
    const found=ConfirmStore.decideHuman(String(req.params.id),req.body.approve);
    res.status(found?200:404).json({decided:found});
  });
  app.get("/admin/status", (_req, res) => res.json(deps.status()));

  app.post("/admin/panic", (_req, res) => {
    deps.onPanic();
    res.json({ stopped: true, persistence: deps.tokenStore.persistence });
  });

  app.post("/admin/revoke", (_req, res) => {
    deps.onRevoke();
    res.json({ revoked: true, persistence: deps.tokenStore.persistence });
  });

  app.post("/admin/rotate", (_req, res) => {
    const token = deps.tokenStore.rotate();
    res.setHeader("Cache-Control", "no-store");
    res.json({ token, persistence: deps.tokenStore.persistence, persisted: deps.tokenStore.persistence === "persisted" });
  });

  const server: Server = app.listen(port, "127.0.0.1", () => {
    process.stderr.write(`[universal-ai-bridge] admin (loopback) em http://127.0.0.1:${port}\n`);
  });
  server.on("clientError", (_e, sock) => sock.writable && sock.end("HTTP/1.1 400 Bad Request\r\n\r\n"));

  return { close: () => server.close() };
}
