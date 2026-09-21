// Authenticated handshake. Credentials are read from config, never argv.
import {loadConfig} from '../dist/config.js';
let session, url, headers;
try {
 const config=loadConfig();
 try { url=new URL(process.env.BRIDGE_ENDPOINT || `http://127.0.0.1:${config.port}/mcp`); }
 catch { throw new Error('Endpoint invalido.'); }
 if(url.username||url.password||url.search||url.hash)throw new Error('Use endpoint sem credenciais/query.');
 if(url.protocol!=='https:' && !(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Endpoint remoto exige HTTPS.');
 headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${config.token || ''}`};
 async function request(body) {
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`MCP HTTP ${response.status}`);
  session=response.headers.get('mcp-session-id')||session;
  if(session)headers['mcp-session-id']=session;
  if(response.status===202)return;
  const raw=await response.text(),line=raw.split('\n').find(s=>s.startsWith('data:'));
  const data=JSON.parse(line?line.slice(5):raw);if(data.error)throw new Error('Erro de protocolo MCP.');return data.result;
 }
 await request({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'bridge-doctor',version:'0.7.0'}}});
 await request({jsonrpc:'2.0',method:'notifications/initialized'});
 const result=await request({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
 if(!Array.isArray(result.tools))throw new Error('Lista de ferramentas invalida.');
 console.log(JSON.stringify({ok:true,authentication:true,mcp:true,tools:result.tools.length}));
} catch(e) {
 // Fetch/parser errors can contain URLs or response bodies. Only fixed diagnostics.
 const safe=/^(Endpoint|Use endpoint|MCP HTTP|Erro de protocolo|Lista de ferramentas|BRIDGE_ENV_FILE)/.test(e.message);
 console.error(JSON.stringify({ok:false,error:safe?e.message:'Falha no diagnostico; verifique configuracao e conectividade.'}));process.exitCode=1;
} finally {
 if(session) {
  try { const response=await fetch(url,{method:'DELETE',headers,signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error(); }
  catch { console.error(JSON.stringify({ok:false,error:'Nao foi possivel fechar a sessao de diagnostico.'}));process.exitCode=1; }
 }
}
