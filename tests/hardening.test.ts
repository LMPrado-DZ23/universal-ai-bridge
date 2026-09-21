import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LIMITS, strictBoolean, policySchema, loadLimits } from '../src/config.js';
import { ConfirmStore } from '../src/confirm.js';
import { JobManager } from '../src/jobs.js';
import { Watcher } from '../src/watch.js';
import { Audit } from '../src/audit/log.js';
import { TokenStore } from '../src/security/tokens.js';
import { isolated } from '../src/isolate.js';
import { PolicyEngine } from '../src/policy/engine.js';
const dirs:string[]=[]; const managers:JobManager[]=[];
const dir=()=>{const d=mkdtempSync(join(tmpdir(),'bridge-hardening-'));dirs.push(d);return d;};
afterEach(()=>{for(const m of managers.splice(0))m.destroy();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const manager=(limits={...DEFAULT_LIMITS}, bytes=1000)=>{const m=new JobManager(bytes,limits);managers.push(m);return m;};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

describe('validated boundaries',()=>{
 it.each(['TRUE','yes','garbage','','1'])('rejects boolean %s',v=>expect(()=>strictBoolean(v,'FLAG')).toThrow());
 it.each(['-1','NaN','Infinity','','9999999999'])('rejects resource limit %s',v=>expect(()=>loadLimits({BRIDGE_LIMIT_ACTIVE_JOBS:v})).toThrow());
 it('rejects invalid policy ranges and unknown keys',()=>{
   const original=JSON.parse(readFileSync('config/policy.json','utf8'));
   for(const value of [-1,NaN,Infinity,0,1e12])expect(()=>policySchema.parse({...original,shell:{...original.shell,timeoutMs:value}})).toThrow();
   expect(()=>policySchema.parse({...original,typo:true})).toThrow();
 });
});
describe('bounded confirmations and human decision',()=>{
 it('enforces capacity and expires without a consume',async()=>{
  const s=new ConfirmStore(1,20);s.issue('write',{text:'secret'});expect(()=>s.issue('write',{})).toThrow(/Limite/);
  await sleep(30);expect(s.size).toBe(0);expect(s.issue('write',{})).toBeTruthy();
 });
 it('requires local decision, exact content and single use',()=>{
  const s=new ConfirmStore();const args={path:'a',content:'approved'};const id=s.issueHuman('write',args);
  expect(s.consumeHuman(id,'write',args)).toBe(false);
  expect(ConfirmStore.decideHuman(id,true)).toBe(true);
  expect(s.consumeHuman(id,'write',{...args,content:'changed'})).toBe(false);
  const second=s.issueHuman('write',args);ConfirmStore.decideHuman(second,true);
  expect(s.consumeHuman(second,'write',args)).toBe(true);expect(s.consumeHuman(second,'write',args)).toBe(false);
  const rejected=s.issueHuman('write',args);ConfirmStore.decideHuman(rejected,false);expect(s.consumeHuman(rejected,'write',args)).toBe(false);s.clear();
 });
});
describe('async process lifecycle',()=>{
 it('does not block timers, reports timeout and cleans retained command',async()=>{
  const m=manager();let tick=false;setTimeout(()=>{tick=true;},20);
  const r=await m.run(process.execPath,['-e','setInterval(()=>{},1000)'],dir(),{},120);
  expect(tick).toBe(true);expect(r.timedOut).toBe(true);expect(m.list()).toEqual([]);
 });
 it('bounds combined UTF-8 stdout/stderr in bytes',async()=>{
  const m=manager();const r=await m.run(process.execPath,['-e',"process.stdout.write('界'.repeat(1000));process.stderr.write('x'.repeat(1000))"],dir(),{},3000);
  expect(r.truncated).toBe(true);expect(Buffer.byteLength(r.stdout)+Buffer.byteLength(r.stderr)).toBeLessThanOrEqual(1000);
 });
 it('rejects global/session saturation and releases ended entries by TTL',async()=>{
  const limits={...DEFAULT_LIMITS,activeJobs:1,globalJobs:1,retainedJobs:1,jobTtlMs:30};
  const a=manager(limits),b=manager(limits);const d=dir();const id=a.start(process.execPath,['-e','setInterval(()=>{},1000)'],d);
  expect(()=>a.start(process.execPath,[],d)).toThrow(/Limite/);expect(()=>b.start(process.execPath,[],d)).toThrow(/Limite/);
  expect(()=>a.write(id,'x'.repeat(DEFAULT_LIMITS.stdinBytes+1))).toThrow(/stdin/);
  a.cancel(id);await sleep(150);expect(a.list()).toEqual([]);
 });
 it('spawn failure settles and disposed session cancels an awaited command',async()=>{
  const m=manager();const bad=await m.run(process.execPath,[],join(dir(),'absent'),{},1000);expect(bad.status).not.toBe(0);
  const running=m.run(process.execPath,['-e','setInterval(()=>{},1000)'],dir(),{},1000);await sleep(30);m.destroy();
  const result=await running;expect(result.timedOut).toBe(false);
 });
 it('watcher capacity and destroy are enforced',()=>{
  const w=new Watcher(1);try {const id=w.start(dir(),'.',false);expect(()=>w.start(dir(),'.',false)).toThrow(/Limite/);w.stop(id);w.destroy();w.destroy();expect(()=>w.start(dir(),'.',false)).toThrow(/encerrada/);}finally{w.destroy();}
 });
});
describe('workers and documents',()=>{
 it('terminates catastrophic regex and leaves event loop responsive',async()=>{
  let tick=false;setTimeout(()=>{tick=true;},20);
  await expect(isolated({kind:'edit',current:'a'.repeat(50000)+'!',pattern:'(a+)+$',replacement:'x',all:true,maxBytes:100000},150)).rejects.toThrow(/limite/);
  expect(tick).toBe(true);
 });
 it('rejects an oversized document before parsing',async()=>{
  const p=join(dir(),'big.csv');writeFileSync(p,'a'.repeat(2000001));
  await expect(isolated({kind:'document',format:'sheet',path:p,maxBytes:5000000})).rejects.toThrow(/2 MB/);
 });
 it('rejects controlled ZIP bomb by actual expansion',async()=>{
  const {default:ExcelJS}=await import('exceljs');const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('bomb');
  for(let i=0;i<2000;i++)ws.addRow(['x'.repeat(10000)+i]);
  const p=join(dir(),'bomb.xlsx');await wb.xlsx.writeFile(p);
  await expect(isolated({kind:'document',format:'sheet',path:p,maxBytes:2000000,offset:0,maxRows:1},5000)).rejects.toThrow(/ZIP/);
 });
});
describe('audit and credentials',()=>{
 it('never logs nested secrets, paths, queries, URL or error text',()=>{
  const d=dir();const audit=new Audit(d,true);const secret='TOP_SECRET_012345';
  audit.record({tool:'search_content',decision:'error',args:{path:secret,query:secret,stdin:secret,rows:[[secret]],url:'https://'+secret+'.example/'+secret},detail:secret});
  const content=readdirSync(d).map(f=>readFileSync(join(d,f),'utf8')).join('');expect(content).toContain('search_content');expect(content).not.toContain(secret);
 });
 it('required audit fails visibly',()=>{
  const d=dir();const audit=new Audit(d,true);rmSync(d,{recursive:true});writeFileSync(d,'not-directory');expect(()=>audit.record({tool:'write_file',decision:'allow',args:{}})).toThrow(/obrigatória/);
 });
 it('rotation exposes verified persistence and failure without leaking secret',()=>{
  const d=dir(),p=join(d,'.env');writeFileSync(p,'BRIDGE_TOKEN=old\n');const s=new TokenStore('old',p);const next=s.rotate();expect(s.persistence).toBe('persisted');expect(readFileSync(p,'utf8').includes(next)).toBe(true);expect(s.matches('old')).toBe(false);
  rmSync(p);mkdirSync(p);const next2=s.rotate();expect(s.persistence).toBe('failed');expect(s.matches(next2)).toBe(true);
 });
});
it('session abort terminates an in-progress regex worker',async()=>{
 const controller=new AbortController();
 const work=isolated({kind:'edit',current:'a'.repeat(50000)+'!',pattern:'(a+)+$',replacement:'x',all:true,maxBytes:100000},5000,controller.signal);
 const assertion=expect(work).rejects.toThrow(/encerrada/);
 setTimeout(()=>controller.abort(),50);await assertion;
});
it('revoke persists and removes duplicate env token definitions',()=>{
 const p=join(dir(),'.env');writeFileSync(p,'BRIDGE_TOKEN=old\nexport BRIDGE_TOKEN = duplicate\nOTHER=keep\n');
 const tokens=new TokenStore('old',p);tokens.rotate();expect(readFileSync(p,'utf8').match(/BRIDGE_TOKEN/g)).toHaveLength(1);
 tokens.revoke();expect(tokens.persistence).toBe('persisted');expect(readFileSync(p,'utf8')).toContain('BRIDGE_TOKEN=\n');expect(tokens.matches('old')).toBe(false);
});

it('PDF subprocess abort releases global quota before returning', async () => {
  const controller = new AbortController();
  const task = {kind:'document', format:'pdf', path:join(dir(),'missing.pdf'), maxBytes:2000000};
  const work = isolated(task, 5000, controller.signal);
  const assertion = expect(work).rejects.toThrow(/encerrada/);
  controller.abort();
  await assertion;
  // Every completed child must release capacity, even when it fails before parsing.
  for(let i=0;i<5;i++) await expect(isolated(task)).rejects.toThrow(/parsing de PDF/);
});
it('PDF subprocess deadline terminates its process and settles', async () => {
  const task = {kind:'document', format:'pdf', path:join(dir(),'missing.pdf'), maxBytes:2000000};
  await expect(isolated(task, 1)).rejects.toThrow(/limite/);
});
