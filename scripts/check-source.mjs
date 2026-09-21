import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const allowed=new Set(['.ts','.js','.mjs','.json','.md','.yml','.yaml','.ps1','.iss','.example']);
let count=0;
function walk(dir) {
  for(const e of readdirSync(dir,{withFileTypes:true})) {
    if(['.git','node_modules','dist','audit','workspace','validation-artifacts','dist-release','Output'].includes(e.name))continue;
    const p=join(dir,e.name);
    if(e.isDirectory())walk(p);
    else if(allowed.has(extname(p))) {
      const bytes=readFileSync(p);
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(extname(p)==='.ps1' && /[^\x00-\x7f]/.test(text) && !bytes.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))) {
        throw new Error(`PowerShell 5.1 exige UTF-8 BOM para texto nao ASCII: ${p}`);
      }
      if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw new Error(`Controle indevido: ${p}`);
      count++;
    }
  }
}
walk('.');console.log(`UTF-8 e controles: ${count} arquivos verificados.`);
