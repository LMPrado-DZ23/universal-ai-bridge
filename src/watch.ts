import { watch, type FSWatcher } from "node:fs";
import { randomBytes } from "node:crypto";

export interface WatchEvent {
  type: string; // "rename" | "change"
  file: string;
  at: string;
}

interface WatchEntry {
  id: string;
  path: string;
  fsw: FSWatcher;
  events: WatchEvent[];
}

/**
 * Monitor de arquivos por polling: watch_start abre um observador, watch_poll
 * devolve os eventos acumulados desde o cursor, watch_stop encerra.
 * Eventos ficam bufferizados (com teto) até serem lidos.
 */
export class Watcher {
  private entries = new Map<string, WatchEntry>();
  private static all = new Set<Watcher>();
  private cap = 1000;

  private destroyed = false;
  constructor(private maxActive = 8) {
    Watcher.all.add(this);
  }

  static stopAllEverywhere(): void {
    for (const w of Watcher.all) w.stopAll();
  }

  start(absPath: string, displayPath: string, recursive: boolean): string {
    if (this.destroyed) throw new Error("Sessão encerrada.");
    if (this.entries.size >= this.maxActive) throw new Error("Limite de watchers atingido.");
    const id = randomBytes(5).toString("hex");
    const fsw = watch(absPath, { recursive }, (eventType, filename) => {
      const entry = this.entries.get(id);
      if (!entry) return;
      if (entry.events.length >= this.cap) entry.events.shift();
      entry.events.push({
        type: eventType,
        file: filename ? `${displayPath}/${String(filename).split("\\").join("/")}` : displayPath,
        at: new Date().toISOString(),
      });
    });
    fsw.on("error", () => { fsw.close(); this.entries.delete(id); });
    this.entries.set(id, { id, path: displayPath, fsw, events: [] });
    return id;
  }

  private get(id: string): WatchEntry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Watch não encontrado: ${id}`);
    return e;
  }

  poll(id: string, drain = true): WatchEvent[] {
    const e = this.get(id);
    const out = e.events.slice();
    if (drain) e.events = [];
    return out;
  }

  list(): { id: string; path: string; pending: number }[] {
    return [...this.entries.values()].map((e) => ({ id: e.id, path: e.path, pending: e.events.length }));
  }

  stop(id: string): void {
    const e = this.get(id);
    e.fsw.close();
    this.entries.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) {
      try {
        this.stop(id);
      } catch {
        /* ignore */
      }
    }
  }

  /** Encerra tudo e remove do registro estático (cleanup de sessão). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopAll();
    Watcher.all.delete(this);
  }
}
