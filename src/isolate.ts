import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
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
    if (task.kind === 'document' && task.format === 'pdf') return await isolatedPdf<T>(task, timeout, signal);
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

/** PDF.js 5.x can fault the Windows host when imported in a worker thread.
 * Keep native parsing in its own process; use the same quotas and deadline.
 */
function isolatedPdf<T>(task: Record<string, unknown>, timeout: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp)$/i.test(key)));
    const child = fork(new URL('../dist/workers/task.js', import.meta.url), [], {
      execArgv: ['--max-old-space-size=128', '--max-semi-space-size=16', '--stack-size=4096'],
      env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    });
    let result: T | undefined;
    let received = false;
    let failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill('SIGKILL'); };
    const abort = () => stop(new Error('Sessão encerrada.'));
    const timer = setTimeout(() => stop(new Error('Tempo limite de parsing/busca excedido.')), timeout);
    signal?.addEventListener('abort', abort, {once: true});
    child.once('message', message => {
      const response = message as {error?: string; value?: T};
      received = true;
      if (response.error) failure = new Error('Falha de parsing de PDF.');
      else result = response.value;
      // The task has finished and its parser was destroyed; wait for close before releasing quota.
      child.kill('SIGKILL');
    });
    child.once('error', () => stop(new Error('Processo de PDF falhou.')));
    child.once('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (!received) reject(new Error('Processo de PDF encerrado sem resultado.'));
      else resolve(result as T);
    });
    if (signal?.aborted) abort();
    else child.send(task, error => { if (error) stop(new Error('Processo de PDF indisponível.')); });
  });
}
