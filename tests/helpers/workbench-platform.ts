import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
/** Test double only. This does not prove PostgreSQL/MinIO/Verdaccio/OIDC integration. */
export async function fakeWorkbenchPlatform(componentId:string,packages:string[]){
 let origin='',creates=0,interrupt=false;const uploaded=new Map<string,Buffer>();const keys:string[]=[];
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/v1/auth/oidc/session'){res.end(JSON.stringify({authenticated:true,subject:'workbench-test',roles:['publisher']}));return;}
  if(req.url==='/v1/publishing/options'){res.end(JSON.stringify({categories:[{id:'general',name:'通用',revision:'0',enabled:true},{id:'other',name:'其他',revision:'0',enabled:true}],components:[{componentId,category:'general'}],packages}));return;}
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);
  if(req.url==='/v1/uploads'){creates++;const input=JSON.parse(bytes.toString());res.end(JSON.stringify({uploadSessionId:'workbench-upload',files:input.files.map((f:{path:string})=>({path:f.path,uploadUrl:origin+'/objects/'+encodeURIComponent(f.path),expiresAt:new Date(Date.now()+60000).toISOString()}))}));}
  else if(req.method==='PUT'){if(interrupt){interrupt=false;req.socket.destroy();return;}uploaded.set(decodeURIComponent(req.url!.slice('/objects/'.length)),bytes);res.end();}
  else if(req.url==='/v1/uploads/workbench-upload/complete')res.end(JSON.stringify({status:'complete',verifiedFiles:[...uploaded].map(([path,bytes])=>({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))}));
  else if(req.url==='/v1/releases'){keys.push(String(req.headers['idempotency-key']));res.end(JSON.stringify({jobId:'workbench-job',state:'VALIDATING'}));}
  else res.end(JSON.stringify({state:'READY',stage:'READY',attempt:0,missingArtifacts:[],pollAfterMs:1}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 return{origin,uploaded,keys,creates:()=>creates,interrupt:()=>{interrupt=true;},close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
