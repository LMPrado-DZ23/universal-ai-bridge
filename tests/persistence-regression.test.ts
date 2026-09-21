import {it,expect,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadConfig} from '../src/config.js';
import {TokenStore} from '../src/security/tokens.js';
import {writeAtomic} from '../src/security/atomic-file.js';
const dirs:string[]=[];
function dir(){const d=mkdtempSync(join(tmpdir(),'bridge-persist-'));dirs.push(d);return d;}
afterEach(()=>{vi.unstubAllEnvs();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
it('persisted revocation overrides inherited stale token on restart',()=>{
 const p=join(dir(),'.env'),old='a'.repeat(64);writeFileSync(p,`BRIDGE_TOKEN=${old}\n`);
 vi.stubEnv('BRIDGE_ENV_FILE',p);vi.stubEnv('BRIDGE_TOKEN',old);
 new TokenStore(old,p).revoke();expect(loadConfig().token).toBe('');
});
it('explicit missing env file fails closed instead of resurrecting inherited credentials',()=>{
 vi.stubEnv('BRIDGE_ENV_FILE',join(dir(),'missing.env'));vi.stubEnv('BRIDGE_TOKEN','a'.repeat(64));
 expect(()=>loadConfig()).toThrow(/BRIDGE_ENV_FILE/);
});
it('serializes rotations and revocation in the same process',async()=>{
 const p=join(dir(),'.env');writeFileSync(p,'BRIDGE_TOKEN=\n');const t=new TokenStore(undefined,p);
 const values=await Promise.all(Array.from({length:12},()=>Promise.resolve().then(()=>t.rotate())));
 expect(new Set(values).size).toBe(12);expect(t.matches(values.at(-1))).toBe(true);
 expect(readFileSync(p,'utf8')).toBe(`BRIDGE_TOKEN=${values.at(-1)}\n`);
 t.revoke();expect(readFileSync(p,'utf8')).toBe('BRIDGE_TOKEN=\n');
});
it('atomic write retains destination if commit guard fails and removes temporary file',()=>{
 const d=dir(),p=join(d,'a.txt');writeFileSync(p,'original');let calls=0;
 expect(()=>writeAtomic(p,'replacement',()=>{if(++calls===2)throw new Error('closed');})).toThrow('closed');
 expect(readFileSync(p,'utf8')).toBe('original');expect(readdirSync(d)).toEqual(['a.txt']);
});
it('atomic rename failure cleans the temporary file',()=>{
 const d=dir(),p=join(d,'directory');mkdirSync(p);
 expect(()=>writeAtomic(p,'replacement',()=>{})).toThrow();expect(readdirSync(d)).toEqual(['directory']);
});
