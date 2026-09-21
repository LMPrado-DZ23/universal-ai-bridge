import {it,expect,afterEach} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {buildServer} from '../src/server.js';
import type {Config} from '../src/config.js';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();});
async function connect(){
 const workspace=mkdtempSync(join(tmpdir(),'bridge-approval-'));
 const config:Config={mode:'safe',workspace,token:undefined,port:8787,adminPort:8788,maxSessions:2,allowedOrigins:[],allowedHosts:[],approval:'confirm',allowShell:false,allowDocker:false,policy:JSON.parse(readFileSync('config/policy.json','utf8')),auditDir:join(workspace,'audit'),dataDir:workspace,envFile:join(workspace,'.env')};
 const {server,resources}=buildServer(config);const client=new Client({name:'regression',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 cleanup.push(async()=>{resources.dispose();await client.close();await server.close();rmSync(workspace,{recursive:true,force:true});});
 return {workspace,client};
}
it.each([
 {name:'create_project',args:{name:'project',files:{'a.txt':'approved'}},changed:{name:'project',files:{'a.txt':'changed'}},path:'project/a.txt'},
 {name:'write_docx',args:{path:'a.docx',paragraphs:['approved']},changed:{path:'a.docx',paragraphs:['changed']},path:'a.docx'},
 {name:'write_sheet',args:{path:'a.xlsx',rows:[['approved']]},changed:{path:'a.xlsx',rows:[['changed']]},path:'a.xlsx'},
 {name:'write_pdf',args:{path:'a.pdf',text:'approved'},changed:{path:'a.pdf',text:'changed'},path:'a.pdf'},
])('$name binds approval to content',async({name,args,changed,path})=>{
 const {workspace,client}=await connect();const first=await client.callTool({name,arguments:args});
 const token=JSON.stringify(first).match(/confirm_token=\\"([a-f0-9]+)\\"/)?.[1];expect(token).toBeTruthy();
 const rejected=await client.callTool({name,arguments:{...changed,confirm_token:token}});expect(rejected.isError).toBe(true);expect(existsSync(join(workspace,path))).toBe(false);
});
it('rejects hundreds of files before an aggregate read',async()=>{
 const {client}=await connect();const result=await client.callTool({name:'read_multiple_files',arguments:{paths:Array(300).fill('a.txt')}});expect(result.isError).toBe(true);
});
it('create_project reports exact partial progress after a real mid-operation failure',async()=>{
 const {workspace,client}=await connect();
 const args={name:'partial',files:{'first.txt':'ok','first.txt/child.txt':'cannot create child beneath a file'}};
 const first=await client.callTool({name:'create_project',arguments:args});
 const token=JSON.stringify(first).match(/confirm_token=\\"([a-f0-9]+)\\"/)?.[1];expect(token).toBeTruthy();
 const result=await client.callTool({name:'create_project',arguments:{...args,confirm_token:token}});
 expect(result.isError).toBe(true);
 const status=JSON.parse((result.content as {text:string}[])[0].text);
 expect(status.partial).toBe(true);expect(status.completed).toEqual(['first.txt']);
 expect(readFileSync(join(workspace,'partial/first.txt'),'utf8')).toBe('ok');
});
