import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { loadProjectBundle } from '../project/prepare.js';
export const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.map':'application/json'};
export async function startFrozenPreview(bundleDir:string,parentOrigin:string){
 const bundle=await loadProjectBundle(bundleDir);const capability=randomBytes(24).toString('hex');
 const allowed=new Set(bundle.manifest.variants.flatMap(v=>v.examples.flatMap(e=>e.previewFiles.map(f=>f.path))));let origin='';
 const server=createServer((request,response)=>{
  response.setHeader('x-content-type-options','nosniff');response.setHeader('referrer-policy','no-referrer');response.setHeader('cache-control','no-store');
  try {
   if(request.headers.host!==new URL(origin).host || !['GET','HEAD'].includes(request.method??''))throw new Error();
   const url=new URL(request.url??'/',origin);const prefix='/'+capability+'/';
   if(!url.pathname.startsWith(prefix)||/%(?:2e|2f|5c)/i.test(url.pathname))throw new Error();
   const file=decodeURIComponent(url.pathname.slice(prefix.length));if(!allowed.has(file))throw new Error();
   let bytes=Buffer.from(bundle.filesMap.get(file)!);
   if(file.endsWith('.html')) {
    response.setHeader('content-security-policy',"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' "+origin+"; style-src 'unsafe-inline' "+origin+"; img-src data: blob: "+origin+"; font-src "+origin+"; connect-src "+origin+"; base-uri 'none'; frame-ancestors "+parentOrigin);
    bytes=Buffer.from(bytes.toString('utf8').replace('<head>','<head><meta name="juz-parent" content="'+parentOrigin+'">'));
   }
   if(request.headers.origin==='null'||request.headers.origin===parentOrigin)response.setHeader('access-control-allow-origin',request.headers.origin);
   response.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream'}).end(request.method==='HEAD'?undefined:bytes);
  }catch{response.writeHead(404).end();}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 return {bundle,origin,url:(variantId:string)=>{const variant=bundle.manifest.variants.find(v=>v.variantId===variantId);if(!variant)throw new Error('VARIANT_UNKNOWN');return origin+'/'+capability+'/'+variant.examples[0]!.previewEntry;},close:()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
