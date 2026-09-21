import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, lstatSync, opendirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { safeResolve } from '../security/paths.js';
const MAX_TEXT = 200000;
const MAX_EXPANDED = 16000000;
/** Validate central directory AND actual inflated sizes before document libraries allocate. ZIP64 is intentionally refused. */
function zipGuard(b: Buffer) {
  let end = -1;
  for (let i=b.length-22; i>=Math.max(0,b.length-65557); i--) {
    if(b.readUInt32LE(i)===0x06054b50 && i+22+b.readUInt16LE(i+20)===b.length) { end=i; break; }
  }
  if(end<0) throw new Error('ZIP inválido.');
  const entries=b.readUInt16LE(end+10), size=b.readUInt32LE(end+12), start=b.readUInt32LE(end+16);
  if(entries>2048 || b.readUInt16LE(end+8)!==entries || b.readUInt16LE(end+4)!==0 || b.readUInt16LE(end+6)!==0 || start+size>end) throw new Error('ZIP excede limites.');
  let pos=start, total=0;
  for(let i=0;i<entries;i++) {
    if(pos+46>b.length || b.readUInt32LE(pos)!==0x02014b50) throw new Error('ZIP inválido.');
    if(b.readUInt16LE(pos+6)>=45) throw new Error('ZIP64/versao ZIP nao suportada.');
    const flags=b.readUInt16LE(pos+8), method=b.readUInt16LE(pos+10), compressed=b.readUInt32LE(pos+20), expanded=b.readUInt32LE(pos+24), local=b.readUInt32LE(pos+42);
    total+=expanded;
    if(flags&1 || total>MAX_EXPANDED || expanded===0xffffffff || compressed===0xffffffff || local+30>start) throw new Error('Expansão ZIP excede limites.');
    if(b.readUInt32LE(local)!==0x04034b50 || b.readUInt16LE(local+4)>=45 || b.readUInt16LE(local+6)!==flags || b.readUInt16LE(local+8)!==method) throw new Error('ZIP inválido.');
    const data=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
    if(data+compressed>start) throw new Error('ZIP inválido.');
    const raw=b.subarray(data,data+compressed);
    const decoded=method===0 ? raw : method===8 ? inflateRawSync(raw,{maxOutputLength: Math.max(1,Math.min(expanded+1,MAX_EXPANDED))}) : null;
    if(!decoded || decoded.length!==expanded) throw new Error('Tamanho ZIP inválido.');
    pos+=46+b.readUInt16LE(pos+28)+b.readUInt16LE(pos+30)+b.readUInt16LE(pos+32);
  }
  if(pos!==start+size) throw new Error('Diretório ZIP inválido.');
}
function* walk(root: string): Generator<string> {
  const stack=[root]; let seen=0;
  while(stack.length) {
    const dir=opendirSync(stack.pop()!);
    try {
      let entry;
      while((entry=dir.readSync())) {
        if(++seen>20000) throw new Error('Limite de entradas da busca atingido.');
        if(entry.isSymbolicLink()) continue;
        const full=join(dir.path,entry.name);
        if(entry.isDirectory() && !['.git','node_modules','dist','.next','build','.cache'].includes(entry.name)) stack.push(full);
        else if(entry.isFile()) yield full;
      }
    } finally { dir.closeSync(); }
  }
}
async function main(task: Record<string, any>) {
  if(task.kind==='edit') {
    const re=new RegExp(task.pattern,task.all?'g':'');
    let count=0;
    for(const _ of task.current.matchAll(new RegExp(task.pattern,'g'))) { if(++count>10000) throw new Error('Limite de substituições excedido.'); }
    const next=task.current.replace(re,task.replacement);
    if(Buffer.byteLength(next)>task.maxBytes) throw new Error('Resultado excede limite de escrita.');
    return {next,count};
  }
  if(task.kind==='names') {
    const hits:string[]=[];
    for(const f of walk(task.base)) {
      if(f.toLowerCase().includes(task.query.toLowerCase()))hits.push(relative(task.workspace,f).replaceAll('\\','/'));
      if(hits.length>=task.max)break;
    }
    return hits;
  }
  if(task.kind==='search') {
    const re=task.regex ? new RegExp(task.query,task.ignoreCase?'i':'') : undefined;
    const q=task.ignoreCase?task.query.toLowerCase():task.query;
    const hits:string[]=[];let bytes=0,linesSeen=0;
    outer:for(const f of walk(task.base)) {
      const rel=relative(task.workspace,f);
      safeResolve(task.workspace,rel);
      const st=lstatSync(f);
      if(!st.isFile()||st.isSymbolicLink()||st.size>task.maxFileBytes) continue;
      bytes+=st.size;if(bytes>20000000) throw new Error('Limite agregado de busca atingido.');
      const text=readFileSync(f,'utf8');if(text.includes('\0'))continue;
      const lines=text.split(/\r?\n/);
      for(let i=0;i<lines.length;i++) {
        if(++linesSeen>200000)throw new Error('Limite de linhas da busca atingido.');
        if(re?re.test(lines[i]):(task.ignoreCase?lines[i].toLowerCase():lines[i]).includes(q)) {
          hits.push(`${rel.replaceAll('\\','/')}:${i+1}: ${lines[i].trim().slice(0,200)}`);
          if(hits.length>=task.max)break outer;
        }
      }
    }
    return hits;
  }
  if(task.kind==='document') {
    const st=lstatSync(task.path);
    if(!st.isFile()||st.size>Math.min(task.maxBytes,2000000))throw new Error('Documento excede limite de 2 MB.');
    const data=readFileSync(task.path);
    if(task.format==='docx'||(task.format==='sheet' && extname(task.path).toLowerCase()!=='.csv'))zipGuard(data);
    if(task.format==='pdf') {
      const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data});
      try { const info=await parser.getInfo();if(info.total>200)throw new Error('PDF excede 200 páginas.');const result=await parser.getText();if(result.text.length>MAX_TEXT)throw new Error('Texto extraído excede limite.');return result.text; }
      finally {await parser.destroy();}
    }
    if(task.format==='docx') {
      const mammoth=await import('mammoth');const {value}=await mammoth.extractRawText({buffer:data});
      if(value.length>MAX_TEXT||value.split('\n').length>10000)throw new Error('DOCX excede limite de texto/parágrafos.');return value;
    }
    const {default:ExcelJS}=await import('exceljs');const wb=new ExcelJS.Workbook();
    if(extname(task.path).toLowerCase()==='.csv')await wb.csv.readFile(task.path);else await wb.xlsx.readFile(task.path);
    const sheet=task.sheet?wb.getWorksheet(task.sheet):wb.worksheets[0];if(!sheet)throw new Error('Aba não encontrada.');
    let cells=0;for(const sh of wb.worksheets) {if(sh.rowCount>10000||sh.columnCount>100)throw new Error('Planilha excede limites de dimensões.');cells+=sh.rowCount*sh.columnCount;}
    if(cells>100000)throw new Error('Planilha excede limite agregado de células.');
    const rows:unknown[][]=[];let total=0;
    sheet.eachRow(row=>{if(total>=task.offset&&rows.length<task.maxRows)rows.push(Array.isArray(row.values)?row.values.slice(1):[]);total++;});
    const result={sheet:sheet.name,total_rows:total,offset:task.offset,rows};
    if(JSON.stringify(result).length>MAX_TEXT)throw new Error('Página excede limite de texto; reduza max_rows.');return result;
  }
  throw new Error('Operação de worker desconhecida.');
}
function run(task: Record<string, any>, reply: (result: unknown) => void) {
  void main(task).then(value => reply({value}), e => reply({error:e instanceof Error ? e.message : 'Falha de parsing.'}));
}
if (parentPort) {
  run(workerData, result => parentPort!.postMessage(result));
} else {
  // PDF imports run on a child process main thread: native faults cannot kill the bridge.
  process.once('disconnect', () => process.exit(0));
  process.once('message', task => run(task as Record<string, any>, result => {
    process.send!(result as object, () => process.disconnect());
  }));
}
