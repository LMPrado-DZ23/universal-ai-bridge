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
it('private atomic write applies a current-user-only ACL on Windows and 0600 on POSIX',async()=>{
 const {writePrivateAtomic}=await import('../src/security/private-file.js');
 const {statSync}=await import('node:fs');
 const p=join(dir(),'private.txt');writePrivateAtomic(p,'test data');
 expect(readFileSync(p,'utf8')).toBe('test data');
 if(process.platform!=='win32'){expect(statSync(p).mode & 0o777).toBe(0o600);return;}
 const {spawnSync}=await import('node:child_process');
 const code='$ErrorActionPreference="Stop";$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$acl=Get-Acl -LiteralPath $env:UAB_TEST_PATH;if(-not $acl.AreAccessRulesProtected){exit 2};foreach($r in $acl.Access){if($r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid){exit 3}};if($acl.Access.Count -ne 1){exit 4}';
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{env:{...process.env,UAB_TEST_PATH:p},windowsHide:true,stdio:'ignore',timeout:10000,shell:false});
 expect(r.status).toBe(0);
});
