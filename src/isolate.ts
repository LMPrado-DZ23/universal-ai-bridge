import { Worker } from 'node:worker_threads';
let active = 0;
const sessions = new WeakMap<AbortSignal, number>();
/** Fixed worker code only; callers supply data, never executable source. */
export async function isolated<T>(task: Record<string, unknown>, timeout = 5000, signal?: AbortSignal): Promise<T> {
  if(signal?.aborted)throw new Error("Sessão encerrada.");
  if (active >= 4) throw new Error('Limite global de parsers/buscas atingido.');
  if (signal && (sessions.get(signal) ?? 0) >= 2) throw new Error("Limite de workers da sessão atingido.");
  active++;
  if (signal) sessions.set(signal, (sessions.get(signal) ?? 0) + 1);
  try {
    return await new Promise<T>((resolve, reject) => {
      const worker = new Worker(new URL('../dist/workers/task.js', import.meta.url), {
        workerData: task, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort",abort);
        void worker.terminate().finally(() => error ? reject(error) : resolve(value as T));
      };
      const abort=()=>finish(new Error("Sessão encerrada."));
      signal?.addEventListener("abort",abort,{once:true});
      const timer = setTimeout(() => finish(new Error('Tempo limite de parsing/busca excedido.')), timeout);
      worker.once('message', m => m.error ? finish(new Error(m.error)) : finish(undefined, m.value));
      worker.once('error', () => finish(new Error('Worker excedeu limites ou falhou.')));
      worker.once('exit', code => { if (!settled) finish(new Error(`Worker encerrado (${code}).`)); });
    });
  } finally { active--; if (signal) sessions.set(signal, (sessions.get(signal) ?? 1) - 1); }
}
