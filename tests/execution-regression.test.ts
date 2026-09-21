import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobManager } from '../src/jobs.js';
const roots: string[] = [], managers: JobManager[] = [];
function dir() { const p = mkdtempSync(join(tmpdir(), 'bridge-exec-')); roots.push(p); return p; }
function manager(bytes = 1000) { const m = new JobManager(bytes); managers.push(m); return m; }
afterEach(() => { for (const m of managers.splice(0)) m.destroy(); for (const d of roots.splice(0)) rmSync(d, {recursive:true,force:true}); vi.unstubAllEnvs(); vi.resetModules(); });
it('Windows lookup selects npm.cmd instead of the sibling POSIX npm script', async () => {
 const d = dir(); writeFileSync(join(d,'npm'),'#!/bin/sh'); writeFileSync(join(d,'npm.cmd'),'@echo off');
 const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
 try {
  Object.defineProperty(process,'platform',{value:'win32'}); vi.stubEnv('PATH',d); vi.stubEnv('PATHEXT','.EXE;.CMD;.BAT'); vi.resetModules();
  const {resolveExecutable} = await import('../src/exec.js'); expect(resolveExecutable('npm')).toBe(join(d,'npm.cmd'));
 } finally { Object.defineProperty(process,'platform',platform); }
});
it('spawn failure retains deterministic status, sanitized stderr and no timeout', async () => {
 const r = await manager().run(process.execPath, [], join(dir(),'missing'), {}, 1000);
 expect(r.status).toBe(-1); expect(r.timedOut).toBe(false); expect(r.stderr).toBe('[spawn error] ENOENT');
});
it('unknown executable returns a deterministic command failure', async () => {
 const r = await manager().run('bridge-definitely-missing-executable', [], dir(), {}, 1000);
 expect(r.status).toBe(-1); expect(r.timedOut).toBe(false); expect(r.stderr).not.toContain(process.cwd());
});
it('preserves UTF-8 across separate output chunks', async () => {
 const r = await manager().run(process.execPath,['-e',"process.stdout.write(Buffer.from([0xe7]));setTimeout(()=>process.stdout.write(Buffer.from([0x95,0x8c])),100)"],dir(),{},3000);
 expect(r.stdout).toBe('界');
});
it('truncates UTF-8 only at a complete code point', async () => {
 const r = await manager(4).run(process.execPath,['-e',"process.stdout.write('界界')"],dir(),{},3000);
 expect(r.stdout).toBe('界'); expect(r.truncated).toBe(true);
});
it('reports nonzero exit code without timeout', async () => {
 const r = await manager().run(process.execPath,['-e','process.exit(7)'],dir(),{},3000);
 expect(r.status).toBe(7); expect(r.timedOut).toBe(false);
});
it('batch plan uses separate fixed switches and outer command quotes',async()=>{
 const {batchPlan}=await import('../src/exec.js');
 expect(batchPlan('C:\\Program Files\\nodejs\\npm.cmd',['--version','a b']).spawnArgs).toEqual(['/d','/v:off','/s','/c','""C:\\Program Files\\nodejs\\npm.cmd" "--version" "a b""']);
});
it.each(['&&','|',';','>','<','%PATH%','(',')','"','\n','\r','\0','\t','\x1b','!','^'])('batch rejects reparsing syntax %j',async arg=>{
 const {batchPlan}=await import('../src/exec.js');expect(()=>batchPlan('C:\\npm.cmd',[arg])).toThrow();
});
