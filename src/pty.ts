import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";

/** Resolve o executável para caminho absoluto (node-pty no Windows não faz PATH lookup). */
function resolveExecutable(file: string): string {
  if (isAbsolute(file) && existsSync(file)) return file;
  const isWin = process.platform === "win32";
  const exts = isWin ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const sep = isWin ? ";" : ":";
  for (const dir of (process.env.PATH ?? "").split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const cand = join(dir, file + ext.toLowerCase());
      if (existsSync(cand)) return cand;
      const candUp = join(dir, file + ext);
      if (existsSync(candUp)) return candUp;
    }
  }
  return file; // deixa o spawn falhar com mensagem clara
}

// @lydell/node-pty é opcional (dep nativa com prebuilds). Carregado sob demanda;
// se indisponível na plataforma, as ferramentas de PTY reportam isso claramente.
type PtyModule = { spawn: (file: string, args: string[], opts: Record<string, unknown>) => IPty };
interface IPty {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  pid: number;
}

let mod: PtyModule | null = null;
let loadError: string | null = null;

export async function loadPty(): Promise<{ ok: boolean; error?: string }> {
  if (mod) return { ok: true };
  if (loadError) return { ok: false, error: loadError };
  try {
    mod = (await import("@lydell/node-pty")) as unknown as PtyModule;
    return { ok: true };
  } catch (e) {
    loadError = `PTY indisponível nesta instalação (@lydell/node-pty não carregou): ${(e as Error).message}`;
    return { ok: false, error: loadError };
  }
}

interface PtySession {
  id: string;
  proc: IPty;
  buffer: string;
  exited: boolean;
  exitCode: number | null;
  truncated: boolean;
}

/** Gerencia sessões de PTY (terminal interativo real). */
export class PtyManager {
  private ptys = new Map<string, PtySession>();
  private static all = new Set<PtyManager>();

  constructor(private maxBufferBytes = 1_000_000) {
    PtyManager.all.add(this);
  }

  static killAllEverywhere(): void {
    for (const m of PtyManager.all) m.killAll();
  }

  start(file: string, args: string[], cwd: string, cols: number, rows: number, env: Record<string, string>): string {
    if (!mod) throw new Error("PTY não carregado (chame loadPty antes).");
    const id = randomBytes(6).toString("hex");
    const proc = mod.spawn(resolveExecutable(file), args, {
      name: "xterm-color",
      cols,
      rows,
      cwd,
      env: { ...process.env, ...env },
    });
    const s: PtySession = { id, proc, buffer: "", exited: false, exitCode: null, truncated: false };
    proc.onData((d) => {
      if (s.buffer.length >= this.maxBufferBytes) {
        s.truncated = true;
        return;
      }
      s.buffer += d;
      if (s.buffer.length > this.maxBufferBytes) {
        s.buffer = s.buffer.slice(0, this.maxBufferBytes);
        s.truncated = true;
      }
    });
    proc.onExit((e) => {
      s.exited = true;
      s.exitCode = e.exitCode;
    });
    this.ptys.set(id, s);
    return id;
  }

  private get(id: string): PtySession {
    const s = this.ptys.get(id);
    if (!s) throw new Error(`PTY não encontrado: ${id}`);
    return s;
  }

  output(id: string, since = 0) {
    const s = this.get(id);
    return {
      exited: s.exited,
      exitCode: s.exitCode,
      truncated: s.truncated,
      data: s.buffer.slice(since),
      nextCursor: s.buffer.length,
    };
  }

  write(id: string, data: string): void {
    const s = this.get(id);
    if (s.exited) throw new Error("PTY já terminou.");
    s.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.get(id).proc.resize(cols, rows);
  }

  kill(id: string): void {
    const s = this.get(id);
    try {
      s.proc.kill();
    } catch {
      /* já morto */
    }
    s.exited = true;
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) {
      try {
        this.kill(id);
      } catch {
        /* ignore */
      }
    }
  }
}
