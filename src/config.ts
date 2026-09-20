import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

export type ApprovalMode = "auto" | "confirm" | "local";
export type BridgeMode = "safe" | "admin";

/** Frase exata exigida para habilitar o modo administrador (anti-acidente). */
export const ADMIN_ACK_PHRASE = "eu-aceito-acesso-total";

export interface PolicyFile {
  shell: {
    allow: string[];
    deny: string[];
    denyPatterns: string[];
    maxOutputBytes: number;
    timeoutMs: number;
  };
  files: {
    deniedExtensions: string[];
    maxWriteBytes: number;
    maxReadBytes: number;
    listMaxEntries: number;
  };
}

export interface Config {
  mode: BridgeMode;
  workspace: string;
  token: string | undefined;
  port: number;
  allowedOrigins: string[];
  approval: ApprovalMode;
  allowShell: boolean;
  allowDocker: boolean;
  policy: PolicyFile;
  auditDir: string;
}

/** Carrega variáveis de um arquivo .env para process.env. Silencioso se ausente. */
export function applyEnvFile(path: string): boolean {
  try {
    process.loadEnvFile(path);
    return true;
  } catch {
    return false; // sem .env: usa o process.env já existente
  }
}

function parseApproval(v: string | undefined): ApprovalMode {
  if (v === "auto") return "auto";
  if (v === "local") return "local";
  return "confirm"; // padrão seguro
}

function loadPolicy(): PolicyFile {
  const raw = readFileSync(resolve(projectRoot, "config", "policy.json"), "utf8");
  return JSON.parse(raw) as PolicyFile;
}

/**
 * Resolve as flags de modo. Modo admin é opt-in DELIBERADO: exige
 * BRIDGE_MODE=admin **e** o reconhecimento explícito em BRIDGE_ADMIN_ACK.
 * Sem o reconhecimento, cai em safe (nunca liga admin por acidente).
 */
export function resolveMode(env: NodeJS.ProcessEnv = process.env): {
  mode: BridgeMode;
  allowShell: boolean;
  allowDocker: boolean;
} {
  const wantsAdmin = env.BRIDGE_MODE === "admin";
  const acked = env.BRIDGE_ADMIN_ACK === ADMIN_ACK_PHRASE;

  if (wantsAdmin && !acked) {
    throw new Error(
      `Modo admin pedido, mas sem reconhecimento. Defina BRIDGE_ADMIN_ACK="${ADMIN_ACK_PHRASE}" ` +
        `para confirmar que você entende que o processo terá acesso amplo ao computador.`
    );
  }

  const mode: BridgeMode = wantsAdmin && acked ? "admin" : "safe";

  if (mode === "safe") {
    return {
      mode,
      // Safe: shell só liga com valor explícito "true". Docker sempre bloqueado.
      allowShell: env.BRIDGE_ALLOW_SHELL === "true",
      allowDocker: false,
    };
  }

  // Admin: shell ligado por padrão; Docker só com flag explícita.
  return {
    mode,
    allowShell: env.BRIDGE_ALLOW_SHELL !== "false",
    allowDocker: env.BRIDGE_ALLOW_DOCKER === "true",
  };
}

export function loadConfig(): Config {
  // Carrega .env do diretório do projeto ANTES de ler process.env.
  applyEnvFile(resolve(projectRoot, ".env"));

  const { mode, allowShell, allowDocker } = resolveMode(process.env);

  const workspace = process.env.BRIDGE_WORKSPACE
    ? resolve(process.env.BRIDGE_WORKSPACE)
    : resolve(projectRoot, "workspace");

  const allowedOrigins = (process.env.BRIDGE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    mode,
    workspace,
    token: process.env.BRIDGE_TOKEN,
    port: Number(process.env.BRIDGE_PORT ?? 8787),
    allowedOrigins,
    approval: parseApproval(process.env.BRIDGE_APPROVAL),
    allowShell,
    allowDocker,
    policy: loadPolicy(),
    auditDir: resolve(projectRoot, "audit"),
  };
}
