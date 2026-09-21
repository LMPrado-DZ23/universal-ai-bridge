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
  const {resolveExecutable} = await import('../src/exec.js'); expect(resolveExecutable('npm')?.toLowerCase()).toBe(join(d,'npm.cmd').toLowerCase());
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
it('timeout stops a live process tree without stopping an unrelated process',async()=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const {existsSync,readFileSync}=await import('node:fs');
 const d=dir(),marker=join(d,'child.txt');
 const external=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 const externalClosed=once(external,'close');
 try {
  const childCode="const fs=require('fs');setInterval(()=>fs.writeFileSync(process.argv[1],String(Date.now())),50)";
  const rootCode="const {spawn}=require('child_process');spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{stdio:'ignore'});setInterval(()=>{},1000)";
  const r=await manager().run(process.execPath,['-e',rootCode,childCode,marker],d,{},1800);
  expect(r.timedOut).toBe(true);expect(existsSync(marker)).toBe(true);
  await new Promise(r=>setTimeout(r,150));const before=readFileSync(marker,'utf8');
  await new Promise(r=>setTimeout(r,200));expect(readFileSync(marker,'utf8')).toBe(before);
  expect(external.exitCode).toBeNull();expect(external.killed).toBe(false);
 } finally {external.kill();await externalClosed;}
},10000);
