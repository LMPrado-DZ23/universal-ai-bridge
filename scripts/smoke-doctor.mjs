import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
const freePort=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const port=await freePort();let admin=await freePort();while(admin===port)admin=await freePort();
const data=mkdtempSync(join(tmpdir(),'bridge-doctor-')),envFile=join(data,'.env'),secret=randomBytes(32).toString('hex');
writeFileSync(envFile,`BRIDGE_TOKEN=${randomBytes(32).toString('hex')}\n`,{mode:0o600});
const env={...process.env,BRIDGE_ENV_FILE:envFile,BRIDGE_DATA_DIR:data,BRIDGE_WORKSPACE:data,BRIDGE_MODE:'safe',BRIDGE_ALLOW_SHELL:'false',BRIDGE_APPROVAL:'confirm',BRIDGE_PORT:String(port),BRIDGE_ADMIN_PORT:String(admin),BRIDGE_ADMIN_SECRET:secret};
const server=spawn(process.execPath,['dist/index.js','--transport','http'],{env,stdio:'ignore'});
const closed=once(server,'close');
async function doctor(endpoint) {
 const p=spawn(process.execPath,['scripts/doctor.mjs'],{env:{...env,BRIDGE_ENDPOINT:endpoint},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);
 const [code]=await once(p,'close');return {code,stdout,stderr};
}
try {
 let ready=false;
 for(let i=0;i<100;i++) {try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{} if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}
 if(!ready)throw new Error('Smoke server not ready.');
 const result=await doctor(`http://127.0.0.1:${port}/mcp`);
 if(result.code!==0||!JSON.parse(result.stdout).ok)throw new Error('Doctor handshake failed.');
 const status=await fetch(`http://127.0.0.1:${admin}/admin/status`,{headers:{'x-admin-secret':secret}}).then(r=>r.json());
 if(status.sessions!==0)throw new Error('Doctor leaked session.');
 const unsafe=await doctor('http://example.com/mcp');if(unsafe.code!==1||!unsafe.stderr.includes('HTTPS'))throw new Error('Insecure endpoint accepted.');
 console.log(JSON.stringify({doctor:JSON.parse(result.stdout),sessionCleanup:true,insecureEndpointRejected:true}));
} finally {server.kill();await closed;rmSync(data,{recursive:true,force:true});}
