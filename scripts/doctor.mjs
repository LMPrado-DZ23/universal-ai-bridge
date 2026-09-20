// Authenticated onboarding check. Never place credentials in CLI arguments.
try { process.loadEnvFile(process.env.BRIDGE_ENV_FILE || '.env'); } catch(e) { if(e.code!=='ENOENT')throw e; }
const endpoint=process.env.BRIDGE_ENDPOINT || `http://127.0.0.1:${process.env.BRIDGE_PORT || 8787}/mcp`;
const url=new URL(endpoint);
if(url.username||url.password||url.search||url.hash)throw new Error('Use endpoint sem credenciais/query. Token vem de BRIDGE_TOKEN.');
if(url.protocol!=='https:' && !(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Endpoint remoto exige HTTPS.');
const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${process.env.BRIDGE_TOKEN || ''}`};
let session;
async function request(body) {
 const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error(`MCP HTTP ${response.status}`);
 session=response.headers.get('mcp-session-id')||session;
 if(session)headers['mcp-session-id']=session;
 if(response.status===202)return;
 const raw=await response.text();const line=raw.split('\n').find(s=>s.startsWith('data:'));
 const data=JSON.parse(line?line.slice(5):raw);if(data.error)throw new Error('MCP retornou erro de protocolo.');return data.result;
}
try {
 await request({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'bridge-doctor',version:'0.7.0'}}});
 await request({jsonrpc:'2.0',method:'notifications/initialized'});
 const result=await request({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
 console.log(JSON.stringify({ok:true,authentication:true,mcp:true,tools:result.tools.length}));
} catch(e) {console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}
finally {if(session)await fetch(url,{method:'DELETE',headers,signal:AbortSignal.timeout(3000)}).catch(()=>{});}
