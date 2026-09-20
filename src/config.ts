import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

export type ApprovalMode = "auto" | "confirm" | "local";
export type BridgeMode = "safe" | "admin";

/** Frase exata exigida para habilitar o modo administrador (anti-acidente). */
export const ADMIN_ACK_PHRASE = "I_UNDERSTAND_FULL_PC_ACCESS";

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
  adminPort: number;
  maxSessions: number;
  allowedOrigins: string[];
  allowedHosts: string[];
  approval: ApprovalMode;
  allowShell: boolean;
  allowDocker: boolean;
  policy: PolicyFile;
  auditDir: string;
  dataDir: string;
  envFile: string;
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

const PLACEHOLDER_TOKENS = new Set([
  "troque-por-um-token-aleatorio-forte",
  "changeme",
  "token",
]);

function parseApproval(v: string | undefined): ApprovalMode {
  if (v === undefined || v === "") return "confirm";
  if (v === "auto" || v === "confirm" || v === "local") return v;
  throw new Error(`BRIDGE_APPROVAL inválido: "${v}". Use auto, confirm ou local.`);
}

function parsePort(v: string | undefined): number {
  const n = Number(v ?? 8787);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`BRIDGE_PORT inválido: "${v}". Use um inteiro entre 1 e 65535.`);
  }
  return n;
}

/** Valida o token (quando presente). HTTP sem token é recusado no transporte. */
function validateToken(token: string | undefined): void {
  if (token === undefined || token === "") return;
  if (PLACEHOLDER_TOKENS.has(token.toLowerCase()) || token.length < 16) {
    throw new Error(
      "BRIDGE_TOKEN fraco ou placeholder. Gere um token forte (>=16 chars): " +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
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
  if (env.BRIDGE_MODE !== undefined && env.BRIDGE_MODE !== "" && env.BRIDGE_MODE !== "safe" && env.BRIDGE_MODE !== "admin") {
    throw new Error(`BRIDGE_MODE inválido: "${env.BRIDGE_MODE}". Use safe ou admin.`);
  }
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

function csv(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(): Config {
  // Carrega o .env ANTES de ler process.env. Ordem: BRIDGE_ENV_FILE (definido
  // pelo instalador, aponta p/ a pasta de dados) e depois o .env do projeto.
  if (process.env.BRIDGE_ENV_FILE) applyEnvFile(process.env.BRIDGE_ENV_FILE);
  applyEnvFile(resolve(projectRoot, ".env"));

  const { mode, allowShell, allowDocker } = resolveMode(process.env);

  const workspace = process.env.BRIDGE_WORKSPACE
    ? resolve(process.env.BRIDGE_WORKSPACE)
    : resolve(projectRoot, "workspace");

  // Pasta de dados/auditoria: usa BRIDGE_DATA_DIR quando definido (instalação).
  const dataDir = process.env.BRIDGE_DATA_DIR ? resolve(process.env.BRIDGE_DATA_DIR) : projectRoot;
  const auditDir = resolve(dataDir, "audit");
  const envFile = process.env.BRIDGE_ENV_FILE ? resolve(process.env.BRIDGE_ENV_FILE) : resolve(projectRoot, ".env");

  validateToken(process.env.BRIDGE_TOKEN);

  const port = parsePort(process.env.BRIDGE_PORT);
  // adminPort: validado APÓS derivar o default (port+1 pode estourar 65535).
  const adminPort = process.env.BRIDGE_ADMIN_PORT ? parsePort(process.env.BRIDGE_ADMIN_PORT) : port + 1;
  if (adminPort < 1 || adminPort > 65535) {
    throw new Error(
      `Porta admin inválida (${adminPort}). BRIDGE_PORT+1 estourou o limite — defina BRIDGE_ADMIN_PORT (1–65535).`
    );
  }
  if (adminPort === port) {
    throw new Error("BRIDGE_ADMIN_PORT não pode ser igual a BRIDGE_PORT.");
  }

  const maxSessions = Number(process.env.BRIDGE_MAX_SESSIONS ?? 20);
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new Error(`BRIDGE_MAX_SESSIONS inválido: "${process.env.BRIDGE_MAX_SESSIONS}".`);
  }

  return {
    mode,
    workspace,
    token: process.env.BRIDGE_TOKEN,
    port,
    adminPort,
    maxSessions,
    allowedOrigins: csv(process.env.BRIDGE_ALLOWED_ORIGINS),
    allowedHosts: csv(process.env.BRIDGE_ALLOWED_HOSTS),
    approval: parseApproval(process.env.BRIDGE_APPROVAL),
    allowShell,
    allowDocker,
    policy: loadPolicy(),
    auditDir,
    dataDir,
    envFile,
  };
}
