import { chmodSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
export function makePrivate(path: string): void {
  if (process.platform !== 'win32') { chmodSync(path, 0o600); return; }
  const who = spawnSync('whoami.exe', ['/user','/fo','csv','/nh'], {encoding:'utf8',windowsHide:true,timeout:5000});
  const sid = who.stdout?.match(/S-1-5-[0-9-]+/)?.[0];
  if(who.status!==0 || !sid) throw new Error('Não foi possível determinar SID para ACL privada.');
  const acl=spawnSync('icacls.exe',[path,'/inheritance:r','/grant:r',`*${sid}:(F)`],{windowsHide:true,timeout:5000});
  if(acl.status!==0)throw new Error('Não foi possível aplicar ACL privada.');
}
export function writePrivateAtomic(path:string, content:string):void {
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temp=join(dirname(path),`.private-${randomBytes(12).toString('hex')}`);
  let fd: number | undefined;
  try {
    fd=openSync(temp,'wx',0o600);
    makePrivate(temp);
    writeFileSync(fd,content,'utf8'); fsyncSync(fd);closeSync(fd);fd=undefined;
    renameSync(temp,path);makePrivate(path);
  } finally { if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;} }
}
