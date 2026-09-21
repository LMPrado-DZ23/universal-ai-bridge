import { chmodSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
export function makePrivate(path: string): void {
  if (process.platform !== 'win32') { chmodSync(path, 0o600); return; }
  // Replace the complete DACL, not just inherited rules: an explicit Everyone
  // grant on an existing file must not survive. No credential is passed in argv.
  const script = [
    '$ErrorActionPreference="Stop"',
    '$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
    '$acl=New-Object System.Security.AccessControl.FileSecurity',
    '$acl.SetAccessRuleProtection($true,$false)',
    '$acl.SetOwner($sid)',
    '$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,"FullControl","Allow")',
    '$acl.AddAccessRule($rule)',
    'Set-Acl -LiteralPath $env:UAB_PRIVATE_PATH -AclObject $acl',
  ].join(';');
  const guarded = `try { ${script} } catch { [Console]::Error.WriteLine($_.Exception.GetType().FullName); exit 1 }`;
  const acl=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(guarded,'utf16le').toString('base64')],{
    env:{...process.env,UAB_PRIVATE_PATH:path},windowsHide:true,timeout:10000,encoding:'utf8',shell:false,
  });
  if(acl.status!==0)throw new Error(`Não foi possível aplicar ACL privada (${(acl.error as NodeJS.ErrnoException | undefined)?.code ?? acl.status}; ${acl.stderr?.match(/System\.[A-Za-z0-9.]+Exception/)?.[0] ?? 'PowerShell'}).`);
}
export function writePrivateAtomic(path:string, content:string):void {
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temp=join(dirname(path),`.private-${randomBytes(12).toString('hex')}`);
  let fd: number | undefined;
  try {
    fd=openSync(temp,'wx',0o600);
    makePrivate(temp);
    writeFileSync(fd,content,'utf8'); fsyncSync(fd);closeSync(fd);fd=undefined;
    renameSync(temp,path);
  } finally { if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;} }
}
