import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Framework='vue'|'react';
type OwnedChild={name:string;path:string;markerHash:string;identity:{dev:string;ino:string}};
type ProjectEntry={path:string;sha256:string;bytes:number};
type EvidenceEntry={name:string;sha256:string;bytes:number};
type Identity={dev:string;ino:string};
type InventoryNode={name:string;kind:'file'|'directory'|'symlink';identity:Identity;bytes:number;sha256?:string;target?:string;children?:InventoryNode[]};
type Inventory={identity:Identity;children:InventoryNode[];recursive:boolean};
type Seal={schemaVersion:1;runId:string;parentRoot:string;evidenceRoot:string;payload:Record<string,unknown>;projects:Record<string,ProjectEntry[]>;files:EvidenceEntry[];inventories:{parentRoot:Inventory;projects:Record<string,Inventory>;files:Inventory;evidenceAreas:Record<string,Inventory>;installQuarantines:Record<string,Inventory>;evidenceRoot:Inventory}};
export type BuiltHost={url:string;servedAssets:ReadonlyMap<string,{path:string;sha256:string;bytes:number}>;close():Promise<void>};
export type InstallDeliveryGuard={register(operationId:string):Promise<void>};
export type InstallDeliveryInput={projectRoot:string;backupRoot:string;planDigest:string;targets?:string[]};
export type OwnedRun={runId:string;parentRoot:string;evidenceRoot:string;projectRoots:Record<Framework,string>;makeOwnedProject(name:string):Promise<string>;assertOwnedProject(path:string):Promise<void>;prepareInstallDelivery(options:InstallDeliveryInput):Promise<InstallDeliveryGuard>;registerOwnedPath(path:string,relativePaths:string[]):Promise<void>;createEvidenceArea(name:string):Promise<string>;registerEvidenceAreaContents(path:string,relativePaths:string[]):Promise<void>;trackOwnedProcess(close:()=>Promise<void>):()=>void;writeEvidence(name:string,bytes:Uint8Array):Promise<{path:string;sha256:string;bytes:number}>;stopOwnedProcesses():Promise<void>;sealEvidence(payload:Record<string,unknown>):Promise<string>;cleanup():Promise<void>;abortForTest(options?:{preserveEvidence?:boolean}):Promise<void>};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const MARKER='.t17-owner.json';
const inside=(root:string,value:string)=>{const rel=relative(root,value);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));};
const json=(value:unknown)=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const safeName=(value:string)=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value);
const builtHosts=new WeakMap<object,Map<string,{path:string;sha256:string;bytes:number}>>();
const canonicalJson=(value:unknown):string=>{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';const obj=value as Record<string,unknown>;return '{'+Object.keys(obj).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(obj[key])).join(',')+'}';};
async function ownerMarker(path:string,runId:string,name:string){const bytes=json({schemaVersion:1,runId,name,path:await realpath(path)});await writeFile(join(path,MARKER),bytes,{flag:'wx'});return sha(bytes);}
async function objectIdentity(path:string){const st=await lstat(path,{bigint:true});return{dev:String(st.dev),ino:String(st.ino)};}
async function assertOwner(child:OwnedChild,runId:string){const st=await lstat(child.path);if(!st.isDirectory()||st.isSymbolicLink()||await realpath(child.path)!==resolve(child.path))throw Error('Owned path changed identity or became a link.');const identity=await objectIdentity(child.path);if(identity.dev!==child.identity.dev||identity.ino!==child.identity.ino)throw Error('Owned path filesystem identity changed.');const mp=join(child.path,MARKER),ms=await lstat(mp);if(!ms.isFile()||ms.isSymbolicLink()||ms.nlink>1)throw Error('Ownership marker is unsafe.');const bytes=await readFile(mp);if(sha(bytes)!==child.markerHash)throw Error('Ownership marker changed.');const marker=JSON.parse(bytes.toString()) as {schemaVersion:number;runId:string;name:string;path:string};if(marker.schemaVersion!==1||marker.runId!==runId||marker.name!==child.name||marker.path!==await realpath(child.path))throw Error('Ownership marker mismatch.');}
async function fileSnapshot(root:string){const result:ProjectEntry[]=[];const walk=async(dir:string,prefix:string)=>{for(const entry of await readdir(dir,{withFileTypes:true})){if(!prefix&&['node_modules','dist','.git'].includes(entry.name))continue;const path=join(dir,entry.name),name=prefix?prefix+'/'+entry.name:entry.name,st=await lstat(path);if(st.isSymbolicLink())throw Error('Symbolic links are forbidden in owned project files.');if(st.isDirectory()){await walk(path,name);continue;}if(!st.isFile()||st.nlink>1)throw Error('Unexpected entry in owned directory.');const bytes=await readFile(path);result.push({path:name,sha256:sha(bytes),bytes:bytes.length});}};await walk(root,'');return result.sort((a,b)=>a.path.localeCompare(b.path));}
async function verifyProjectSnapshots(parentRoot:string,projects:Record<string,ProjectEntry[]>){for(const [name,expected] of Object.entries(projects)){if(!safeName(name))throw Error('Evidence seal has unsafe project name.');const root=join(parentRoot,name);if(!inside(parentRoot,root))throw Error('Sealed project escapes owner root.');const current=await fileSnapshot(root);if(canonicalJson(current)!==canonicalJson(expected))throw Error('Owned project snapshot changed after sealing.');}}
async function verifyEvidenceFiles(evidenceRoot:string,files:EvidenceEntry[]){const dir=join(evidenceRoot,'files'),names=await readdir(dir);if(names.length!==files.length)throw Error('Evidence inventory changed after sealing.');const seen=new Set<string>();for(const file of files){if(!safeName(file.name)||seen.has(file.name))throw Error('Evidence seal contains unsafe or duplicate filename.');seen.add(file.name);const path=join(dir,file.name),st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.nlink>1)throw Error('Sealed evidence file changed type.');const bytes=await readFile(path);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Sealed evidence changed.');}}
async function captureNode(path:string,name:string,recursive=true,linkRoot?:string):Promise<InventoryNode>{const st=await lstat(path,{bigint:true}),identity={dev:String(st.dev),ino:String(st.ino)};if(st.isSymbolicLink()){if(!linkRoot||!inside(linkRoot,await realpath(path)))throw Error('Unregistered or escaping symbolic link in owned output.');return{name,kind:'symlink',identity,bytes:0,target:await readlink(path)};}if(st.isFile()){if(st.nlink>1n)throw Error('Owned inventory contains a linked file.');const bytes=await readFile(path);return{name,kind:'file',identity,bytes:bytes.length,sha256:sha(bytes)};}if(!st.isDirectory())throw Error('Owned inventory contains an unsupported entry.');if(!recursive)return{name,kind:'directory',identity,bytes:0};const nextLinkRoot=name==='node_modules'?path:linkRoot,children:InventoryNode[]=[];for(const entry of await readdir(path,{withFileTypes:true}))children.push(await captureNode(join(path,entry.name),entry.name,true,nextLinkRoot));children.sort((a,b)=>a.name.localeCompare(b.name));return{name,kind:'directory',identity,bytes:0,children};}
async function captureInventory(path:string,excludeNames:string[]=[],recursive=true):Promise<Inventory>{const st=await lstat(path,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink())throw Error('Owned inventory root is not a real directory.');const children:InventoryNode[]=[];for(const entry of await readdir(path,{withFileTypes:true})){if(excludeNames.includes(entry.name))continue;children.push(await captureNode(join(path,entry.name),entry.name,recursive));}children.sort((a,b)=>a.name.localeCompare(b.name));return{identity:{dev:String(st.dev),ino:String(st.ino)},children,recursive};}
function inventoryNodePath(root:string,node:InventoryNode){return join(root,node.name);}
function normalizedOwnedPaths(paths:string[]){if(!Array.isArray(paths)||!paths.length)throw Error('Explicit owned paths are required.');const result=new Set<string>();for(const value of paths){if(typeof value!=='string'||!value||value==='.'||isAbsolute(value)||/^[A-Za-z]:/.test(value))throw Error('Owned path must be a non-root relative path.');const normalized=value.replaceAll('\\','/'),parts=normalized.split('/');if(parts.some(part=>!part||part==='.'||part==='..'||!/^[A-Za-z0-9._-]{1,96}$/.test(part))||parts.includes(MARKER))throw Error('Owned path is unsafe.');result.add(parts.join('/'));}return result;}
async function captureDeclaredNode(path:string,name:string,relativePath:string,allowed:Set<string>,strict:boolean):Promise<InventoryNode>{if(allowed.has(relativePath))return captureNode(path,name,true);const prefix=relativePath+'/';const descendants=[...allowed].filter(value=>value.startsWith(prefix)).map(value=>value.slice(prefix.length));if(!descendants.length)throw Error('Owned path was not explicitly registered.');const st=await lstat(path,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink())throw Error('Registered parent path is not a real directory.');const expectedNames=[...new Set(descendants.map(value=>value.split('/')[0]!))].sort(),actualNames=(await readdir(path)).sort();if((strict?canonicalJson(actualNames)!==canonicalJson(expectedNames):expectedNames.some(value=>!actualNames.includes(value))))throw Error('Owned directory contains an unregistered entry.');const children:InventoryNode[]=[];for(const child of expectedNames)children.push(await captureDeclaredNode(join(path,child),child,relativePath+'/'+child,allowed,strict));children.sort((a,b)=>a.name.localeCompare(b.name));return{name,kind:'directory',identity:{dev:String(st.dev),ino:String(st.ino)},bytes:0,children};}
async function captureDeclaredInventory(path:string,paths:Set<string>,options:{strict?:boolean;fixedNames?:string[];recursive?:boolean}={}):Promise<Inventory>{const st=await lstat(path,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink())throw Error('Owned inventory root is not a real directory.');const strict=options.strict!==false,recursive=options.recursive!==false,fixedNames=options.fixedNames??[],expectedNames=[...new Set([...fixedNames,...[...paths].map(value=>value.split('/')[0]!)])].sort(),actualNames=(await readdir(path)).sort();if((strict?canonicalJson(actualNames)!==canonicalJson(expectedNames):expectedNames.some(value=>!actualNames.includes(value))))throw Error('Owned directory contains an unregistered entry.');const children:InventoryNode[]=[];for(const name of expectedNames){if(fixedNames.includes(name)||!recursive){children.push(await captureNode(join(path,name),name,recursive));continue;}children.push(await captureDeclaredNode(join(path,name),name,name,paths,strict));}children.sort((a,b)=>a.name.localeCompare(b.name));return{identity:{dev:String(st.dev),ino:String(st.ino)},children,recursive};}
async function assertInventory(path:string,expected:Inventory,excludeNames:string[]=[]){const actual=await captureInventory(path,excludeNames,expected.recursive);if(canonicalJson(actual)!==canonicalJson(expected))throw Error('Owned directory inventory changed; refusing cleanup.');}
async function removeNode(path:string,node:InventoryNode):Promise<void>{const st=await lstat(path,{bigint:true}),identity={dev:String(st.dev),ino:String(st.ino)};if(identity.dev!==node.identity.dev||identity.ino!==node.identity.ino)throw Error('Owned cleanup entry identity changed.');if(node.kind==='symlink'){if(!st.isSymbolicLink()||await readlink(path)!==node.target)throw Error('Owned cleanup link changed.');await unlink(path);return;}if(node.kind==='file'){if(!st.isFile()||Number(st.size)!==node.bytes||!node.sha256||sha(await readFile(path))!==node.sha256)throw Error('Owned cleanup file changed.');await unlink(path);return;}if(!st.isDirectory()||!node.children)throw Error('Owned cleanup directory changed.');const names=await readdir(path);const expectedNames=node.children.map(child=>child.name).sort();if(canonicalJson(names.sort())!==canonicalJson(expectedNames))throw Error('Owned cleanup directory inventory changed.');for(const child of node.children)await removeNode(inventoryNodePath(path,child),child);if((await readdir(path)).length)throw Error('Owned cleanup directory gained an entry.');await rmdir(path);}
async function removeDisposableCache(path:string,area:string,expected:Identity):Promise<void>{
  const cacheRoot=resolve(path),areaRoot=resolve(area);if(!inside(areaRoot,cacheRoot)||cacheRoot===areaRoot)throw Error('Frozen CLI cache escaped its private install area.');
  const rootStat=await lstat(cacheRoot,{bigint:true}),rootIdentity={dev:String(rootStat.dev),ino:String(rootStat.ino)};
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootIdentity.dev!==expected.dev||rootIdentity.ino!==expected.ino||await realpath(cacheRoot)!==cacheRoot)throw Error('Frozen CLI cache directory changed identity.');
  const removeOwnedEntry=async(entryPath:string):Promise<void>=>{
    if(!inside(cacheRoot,entryPath)||entryPath===cacheRoot)throw Error('Frozen CLI cache entry escaped its root.');
    const stat=await lstat(entryPath,{bigint:true});if(stat.isSymbolicLink())throw Error('Frozen CLI cache contains an unexpected symbolic link.');
    if(stat.isDirectory()){
      const identity={dev:String(stat.dev),ino:String(stat.ino)};for(const name of await readdir(entryPath))await removeOwnedEntry(join(entryPath,name));
      const current=await lstat(entryPath,{bigint:true});if(!current.isDirectory()||current.isSymbolicLink()||String(current.dev)!==identity.dev||String(current.ino)!==identity.ino||(await readdir(entryPath)).length)throw Error('Frozen CLI cache directory changed during cleanup.');await rmdir(entryPath);return;
    }
    if(!stat.isFile()||stat.nlink>1n)throw Error('Frozen CLI cache contains an unsupported or linked entry.');await unlink(entryPath);
  };
  for(const name of await readdir(cacheRoot))await removeOwnedEntry(join(cacheRoot,name));
  const current=await lstat(cacheRoot,{bigint:true});if(!current.isDirectory()||current.isSymbolicLink()||String(current.dev)!==expected.dev||String(current.ino)!==expected.ino||(await readdir(cacheRoot)).length)throw Error('Frozen CLI cache changed during cleanup.');
  await rmdir(cacheRoot);
}
async function removeInventory(path:string,expected:Inventory){const st=await lstat(path,{bigint:true});const identity={dev:String(st.dev),ino:String(st.ino)};if(!st.isDirectory()||st.isSymbolicLink()||identity.dev!==expected.identity.dev||identity.ino!==expected.identity.ino)throw Error('Owned cleanup root identity changed.');const names=await readdir(path);const expectedNames=expected.children.map(child=>child.name).sort();if(canonicalJson(names.sort())!==canonicalJson(expectedNames))throw Error('Owned cleanup root inventory changed.');for(const child of expected.children)await removeNode(inventoryNodePath(path,child),child);if((await readdir(path)).length)throw Error('Owned cleanup root gained an entry.');await rmdir(path);}
async function removeRegisteredRoot(path:string,expected:Inventory,nested:Map<string,Inventory>){
  const st=await lstat(path,{bigint:true}),identity={dev:String(st.dev),ino:String(st.ino)};
  if(!st.isDirectory()||st.isSymbolicLink()||identity.dev!==expected.identity.dev||identity.ino!==expected.identity.ino)throw Error('Owned cleanup root identity changed.');
  const names=(await readdir(path)).sort(),expectedNames=expected.children.map(child=>child.name).sort();
  if(canonicalJson(names)!==canonicalJson(expectedNames))throw Error('Owned cleanup root inventory changed.');
  for(const child of expected.children){const childPath=join(path,child.name),inventory=nested.get(child.name);if(inventory){if(child.kind!=='directory'||child.identity.dev!==inventory.identity.dev||child.identity.ino!==inventory.identity.ino)throw Error('Owned cleanup directory registration changed.');await removeInventory(childPath,inventory);}else{if(child.kind==='directory')throw Error('Owned cleanup directory registration is missing.');await removeNode(childPath,child);}}
  if((await readdir(path)).length)throw Error('Owned cleanup root gained an entry.');
  await rmdir(path);
}
export async function createOwnedRun(options:{baseDirectory?:string}={}):Promise<OwnedRun>{
  const base=resolve(options.baseDirectory??tmpdir()),baseStat=await lstat(base);
  if(!baseStat.isDirectory()||baseStat.isSymbolicLink())throw Error('Temporary base must be a real directory.');
  const runId=randomBytes(16).toString('hex'),parentRoot=await mkdtemp(join(base,'zhinexus-t17-'+runId+'-')),evidenceRoot=await mkdtemp(join(base,'zhinexus-t17-evidence-'+runId+'-'));
  if(inside(parentRoot,evidenceRoot)||inside(evidenceRoot,parentRoot))throw Error('Evidence must be external to projects.');
  const filesRoot=join(evidenceRoot,'files');await mkdir(filesRoot);
  const children=new Map<string,OwnedChild>(),registered=new Map<string,Inventory>(),projectPaths=new Map<string,Set<string>>(),evidenceAreas=new Map<string,{path:string;identity:Identity;paths:Set<string>}>(),evidenceFiles=new Map<string,EvidenceEntry>(),installQuarantines=new Map<string,Inventory>(),pendingDeliveries=new Set<string>(),closers=new Set<()=>Promise<void>>();
  const runChild={name:'run',path:parentRoot,markerHash:await ownerMarker(parentRoot,runId,'run'),identity:await objectIdentity(parentRoot)},evidenceChild={name:'evidence',path:evidenceRoot,markerHash:await ownerMarker(evidenceRoot,runId,'evidence'),identity:await objectIdentity(evidenceRoot)};
  let stopped=false,sealed=false,cleaned=false,sealSha256:string|undefined;
  const registerParent=async()=>{const expected=[MARKER,...children.keys(),...installQuarantines.keys()].sort(),actual=(await readdir(parentRoot)).sort();if(canonicalJson(actual)!==canonicalJson(expected))throw Error('Owner root contains an unregistered entry.');registered.set(parentRoot,await captureInventory(parentRoot,[],false));};
  const registerEvidenceRoot=async(includeSeal=false)=>{const expected=[MARKER,'files',...evidenceAreas.keys(),...(includeSeal?['run-seal.json']:[])].sort(),actual=(await readdir(evidenceRoot)).sort();if(canonicalJson(actual)!==canonicalJson(expected))throw Error('Evidence root contains an unregistered entry.');registered.set(evidenceRoot,await captureInventory(evidenceRoot,[],false));};
  const makeOwnedProject=async(name:string)=>{
    if(!safeName(name)||children.has(name))throw Error('Invalid or duplicate owned project.');
    const path=join(parentRoot,name);await mkdir(path);const child={name,path,markerHash:await ownerMarker(path,runId,name),identity:await objectIdentity(path)};children.set(name,child);projectPaths.set(path,new Set());registered.set(path,await captureDeclaredInventory(path,new Set(),{fixedNames:[MARKER]}));await registerParent();return path;
  };
  const assertOwnedProject=async(path:string)=>{const target=resolve(path),child=[...children.values()].find(value=>resolve(value.path)===target);if(!child)throw Error('Only an owned project can be used as an execution root.');await assertOwner(child,runId);};
  const registerOwnedPath=async(path:string,relativePaths:string[])=>{
    if(cleaned||sealed)throw Error('Cannot register project output after the run is closed.');
    const target=resolve(path),child=[...children.values()].find(value=>resolve(value.path)===target);
    if(!child)throw Error('Only an exact owned project root can be registered.');
    await assertOwner(child,runId);const prior=projectPaths.get(child.path);if(!prior)throw Error('Owned project registration is missing.');const previous=registered.get(child.path);if(!previous)throw Error('Owned project inventory is missing.');const existing=await captureDeclaredInventory(child.path,prior,{strict:false,fixedNames:[MARKER]});if(canonicalJson(existing)!==canonicalJson(previous))throw Error('Previously registered project content changed.');const next=new Set(prior);for(const relativePath of normalizedOwnedPaths(relativePaths))next.add(relativePath);const inventory=await captureDeclaredInventory(child.path,next,{fixedNames:[MARKER]});projectPaths.set(child.path,next);registered.set(child.path,inventory);await registerParent();
  };
  const createEvidenceArea=async(name:string)=>{
    if(cleaned||sealed)throw Error('Cannot create an evidence area after the run is closed.');
    if(!safeName(name)||name==='files'||name===MARKER||name==='run-seal.json'||evidenceAreas.has(name))throw Error('Invalid or duplicate evidence area.');
    const path=join(evidenceRoot,name);await mkdir(path);const area={path,identity:await objectIdentity(path),paths:new Set<string>()};evidenceAreas.set(name,area);registered.set(path,await captureDeclaredInventory(path,area.paths));await registerEvidenceRoot();return path;
  };
  const registerEvidenceAreaContents=async(path:string,relativePaths:string[])=>{
    if(cleaned||sealed)throw Error('Cannot register evidence after the run is closed.');
    const target=resolve(path),area=[...evidenceAreas.values()].find(value=>resolve(value.path)===target);
    if(!area)throw Error('Only an exact registered evidence area can be refreshed.');
    const identity=await objectIdentity(area.path);if(identity.dev!==area.identity.dev||identity.ino!==area.identity.ino)throw Error('Evidence area identity changed.');
    const previous=registered.get(area.path);if(!previous)throw Error('Evidence area registration is missing.');const existing=await captureDeclaredInventory(area.path,area.paths,{strict:false});if(canonicalJson(existing)!==canonicalJson(previous))throw Error('Previously registered evidence content changed.');const next=new Set(area.paths);for(const relativePath of normalizedOwnedPaths(relativePaths))next.add(relativePath);const inventory=await captureDeclaredInventory(area.path,next);area.paths=next;registered.set(area.path,inventory);await registerEvidenceRoot();
  };
  // A private pre-execution snapshot is the authority; a filename prefix or journal alone is not.
  const prepareInstallDelivery=async(options:InstallDeliveryInput):Promise<InstallDeliveryGuard>=>{
    if(cleaned||sealed)throw Error('Cannot capture delivery ownership after the run is closed.');
    const projectRoot=resolve(options.projectRoot),backupRoot=resolve(options.backupRoot);
    await assertOwner(runChild,runId);await assertOwner(evidenceChild,runId);await assertOwnedProject(projectRoot);
    const area=[...evidenceAreas.values()].find(candidate=>candidate.path===backupRoot);
    if(!area)throw Error('Delivery backup root must be an exact owned evidence area.');
    if(!/^[0-9a-f]{64}$/.test(options.planDigest)||pendingDeliveries.has(projectRoot))throw Error('Invalid or duplicate delivery ownership capture.');
    const assertBackupArea=async()=>{
      const st=await lstat(backupRoot,{bigint:true});
      if(!st.isDirectory()||st.isSymbolicLink()||await realpath(backupRoot)!==backupRoot
        ||String(st.dev)!==area.identity.dev||String(st.ino)!==area.identity.ino)throw Error('Delivery backup area identity changed.');
    };
    await assertBackupArea();
    const backupInventory=registered.get(backupRoot),parentInventory=registered.get(parentRoot);
    if(!backupInventory||!parentInventory)throw Error('Delivery ownership registration is missing.');
    await assertInventory(backupRoot,backupInventory);await assertInventory(parentRoot,parentInventory);
    if((await readdir(backupRoot)).length)throw Error('Delivery backup area must be empty before the operation.');
    const rawTargets=options.targets??['node_modules'],targets=normalizedOwnedPaths(rawTargets);
    if(targets.size!==rawTargets.length)throw Error('Delivery targets must be unique.');
    const originals=new Map<string,Inventory|undefined>(),ancestorIdentities=new Map<string,Identity>();
    const linkFree=(nodes:InventoryNode[]):boolean=>nodes.every(node=>node.kind!=='symlink'&&(!node.children||linkFree(node.children)));
    for(const target of targets){
      if(target!=='node_modules'&&!target.endsWith('/node_modules'))throw Error('Delivery target must be an exact node_modules directory.');
      const parts=target.split('/');let ancestor=projectRoot;
      for(const part of parts.slice(0,-1)){
        ancestor=join(ancestor,part);const st=await lstat(ancestor);
        if(!st.isDirectory()||st.isSymbolicLink()||await realpath(ancestor)!==ancestor)throw Error('Delivery importer ancestor is unsafe.');
        ancestorIdentities.set(ancestor,await objectIdentity(ancestor));
      }
      const path=join(projectRoot,target);let inventory:Inventory|undefined;
      try{inventory=await captureInventory(path);}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(inventory&&!linkFree(inventory.children))throw Error('Delivery original dependency tree contains a link.');
      originals.set(target,inventory);
    }
    const before=await captureInventory(parentRoot,[],false),planDigest=options.planDigest;
    pendingDeliveries.add(projectRoot);let used=false;
    return Object.freeze({async register(operationId:string){
      if(used||cleaned||sealed)throw Error('Delivery guard may only be used once before the run is closed.');
      used=true;
      if(!safeName(operationId))throw Error('Delivery operation id is unsafe.');
      await assertOwner(runChild,runId);await assertOwner(evidenceChild,runId);await assertOwnedProject(projectRoot);await assertBackupArea();
      for(const [path,identity] of ancestorIdentities){
        const st=await lstat(path);
        if(!st.isDirectory()||st.isSymbolicLink()||await realpath(path)!==path||canonicalJson(await objectIdentity(path))!==canonicalJson(identity))throw Error('Delivery importer ancestor identity changed.');
      }
      if(canonicalJson((await readdir(backupRoot)).sort())!==canonicalJson([operationId]))throw Error('Delivery backup area contains an unknown or duplicate operation.');
      const operationRoot=join(backupRoot,operationId),operationStat=await lstat(operationRoot);
      if(!operationStat.isDirectory()||operationStat.isSymbolicLink()||await realpath(operationRoot)!==operationRoot)throw Error('Delivery operation directory is linked or unsafe.');
      const operationNames=await readdir(operationRoot);
      if(!operationNames.includes('install-delivery.json')||operationNames.some(name=>!['install-delivery.json','latest.json','versions'].includes(name)))throw Error('Delivery operation contains an unknown journal or entry.');
      const journalPath=join(operationRoot,'install-delivery.json'),journalStat=await lstat(journalPath,{bigint:true});
      if(!journalStat.isFile()||journalStat.isSymbolicLink()||journalStat.nlink!==1n||await realpath(journalPath)!==journalPath)throw Error('Delivery journal must be an ordinary retained file.');
      const journalBytes=await readFile(journalPath),journalAfter=await lstat(journalPath,{bigint:true});
      if(!journalAfter.isFile()||journalAfter.isSymbolicLink()||journalAfter.nlink!==1n||journalAfter.dev!==journalStat.dev||journalAfter.ino!==journalStat.ino||journalAfter.size!==BigInt(journalBytes.length))throw Error('Delivery journal identity changed during read-back.');
      const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
      const journal:unknown=JSON.parse(journalBytes.toString('utf8'));
      if(!record(journal)||journal.schemaVersion!==1||journal.kind!=='t16-install-delivery'||journal.operationId!==operationId
        ||journal.projectRoot!==projectRoot.replaceAll('\\','/')||journal.planDigest!==planDigest||!Array.isArray(journal.entries)||journal.entries.length!==targets.size)throw Error('Delivery journal identity, plan, or importer inventory is invalid.');
      const seenTargets=new Set<string>(),roots=new Map<string,Set<string>>();
      for(const entry of journal.entries){
        if(!record(entry)||typeof entry.target!=='string'||!targets.has(entry.target)||seenTargets.has(entry.target)
          ||Object.keys(entry).some(key=>!['importer','target','hadOriginal','state','quarantine'].includes(key)))throw Error('Delivery journal contains an unknown or duplicate importer.');
        seenTargets.add(entry.target);const original=originals.get(entry.target),importer=entry.target==='node_modules'?'.':entry.target.slice(0,-'/node_modules'.length);
        if(entry.importer!==importer||entry.hadOriginal!==Boolean(original)||!['planned','quarantined','delivered'].includes(String(entry.state)))throw Error('Delivery journal does not match the captured original tree.');
        if(!original||entry.state==='planned'){
          if(entry.quarantine!==undefined||(!original&&entry.state==='quarantined'))throw Error('Delivery journal claims an unowned quarantine.');
          if(original)await assertInventory(join(projectRoot,entry.target),original);
          continue;
        }
        if(typeof entry.quarantine!=='string'||!isAbsolute(entry.quarantine))throw Error('Delivery journal quarantine path is invalid.');
        const path=resolve(entry.quarantine),root=dirname(path),name=basename(root),child=importer==='.'?'root':importer.replace(/[^A-Za-z0-9._-]+/g,'_');
        if(dirname(root)!==parentRoot||basename(path)!==child||!/^\.t16-quarantine-[A-Za-z0-9._-]{1,96}$/.test(name)
          ||before.children.some(node=>node.name===name)||children.has(name)||installQuarantines.has(name))throw Error('Delivery journal quarantine is not a new owned sibling.');
        await assertInventory(path,original);
        const names=roots.get(name)??new Set<string>();if(names.has(child))throw Error('Delivery quarantine child is duplicated.');names.add(child);roots.set(name,names);
      }
      const inventories=new Map<string,Inventory>();
      for(const [name,expectedChildren] of roots){
        const inventory=await captureInventory(join(parentRoot,name));
        if(!linkFree(inventory.children)||canonicalJson(inventory.children.map(node=>node.name).sort())!==canonicalJson([...expectedChildren].sort()))throw Error('Delivery quarantine contains an unknown or linked entry.');
        inventories.set(name,inventory);
      }
      const after=await captureInventory(parentRoot,[],false);
      if(canonicalJson(after.identity)!==canonicalJson(before.identity)
        ||canonicalJson(after.children.filter(node=>!roots.has(node.name)))!==canonicalJson(before.children)
        ||after.children.length!==before.children.length+roots.size)throw Error('Delivery owner root gained an unregistered sibling or changed identity.');
      // Mutate registration only after every journal entry, byte guard and sibling was proven.
      for(const [name,inventory] of inventories){installQuarantines.set(name,inventory);registered.set(join(parentRoot,name),inventory);}
      await registerParent();pendingDeliveries.delete(projectRoot);
    }});
  };
  const projectRoots={vue:await makeOwnedProject('vue'),react:await makeOwnedProject('react')};
  registered.set(filesRoot,await captureDeclaredInventory(filesRoot,new Set()));await registerEvidenceRoot();
  const run:OwnedRun={
    runId,parentRoot,evidenceRoot,projectRoots,makeOwnedProject,assertOwnedProject,prepareInstallDelivery,registerOwnedPath,createEvidenceArea,registerEvidenceAreaContents,
    trackOwnedProcess(close){if(stopped)throw Error('Run stopped.');closers.add(close);return()=>closers.delete(close);},
    async writeEvidence(name,bytes){
      if(cleaned||sealed||!safeName(name)||evidenceFiles.has(name))throw Error('Invalid, duplicate, or late evidence name.');
      await assertOwner(evidenceChild,runId);const path=join(filesRoot,name);await writeFile(path,bytes,{flag:'wx'});
      const entry={name,sha256:sha(bytes),bytes:bytes.length};evidenceFiles.set(name,entry);registered.set(filesRoot,await captureDeclaredInventory(filesRoot,new Set(evidenceFiles.keys())));return{path,...entry};
    },
    async stopOwnedProcesses(){for(const close of [...closers]){await close();closers.delete(close);}stopped=true;},
    async sealEvidence(payload){
      if(!stopped||closers.size)throw Error('Stop owned processes before sealing evidence.');await assertOwner(evidenceChild,runId);
      const projects:Record<string,ProjectEntry[]>={},projectInventories:Record<string,Inventory>={};
      for(const child of children.values()){await assertOwner(child,runId);const inventory=registered.get(child.path);if(!inventory)throw Error('Owned project cleanup registration is missing.');await assertInventory(child.path,inventory);projects[child.name]=await fileSnapshot(child.path);projectInventories[child.name]=inventory;}
      const names=(await readdir(filesRoot)).sort(),registeredNames=[...evidenceFiles.keys()].sort();
      if(canonicalJson(names)!==canonicalJson(registeredNames))throw Error('Evidence inventory contains an unregistered entry.');
      const files=[...evidenceFiles.values()].sort((a,b)=>a.name.localeCompare(b.name));
      const filesInventory=registered.get(filesRoot);if(!filesInventory)throw Error('Evidence files cleanup registration is missing.');await assertInventory(filesRoot,filesInventory);
      for(const [name,area] of evidenceAreas){const expected=registered.get(area.path);if(!expected)throw Error('Evidence area cleanup registration is missing: '+name);await assertInventory(area.path,expected);}
      for(const [name,inventory] of installQuarantines)await assertInventory(join(parentRoot,name),inventory);
      const parentInventory=registered.get(parentRoot),evidenceInventory=registered.get(evidenceRoot);if(!parentInventory||!evidenceInventory)throw Error('Owned root cleanup registration is missing.');await assertInventory(parentRoot,parentInventory);await assertInventory(evidenceRoot,evidenceInventory);
      const inventories={parentRoot:parentInventory,projects:projectInventories,files:filesInventory,installQuarantines:Object.fromEntries(installQuarantines),evidenceAreas:Object.fromEntries([...evidenceAreas].map(([name,area])=>[name,registered.get(area.path)!])),evidenceRoot:evidenceInventory};
      const seal:Seal={schemaVersion:1,runId,parentRoot,evidenceRoot,payload,projects,files,inventories};
      const path=join(evidenceRoot,'run-seal.json'),bytes=json(seal);await writeFile(path,bytes,{flag:'wx'});sealSha256=sha(bytes);await registerEvidenceRoot(true);sealed=true;return path;
    },
    async cleanup(){
      if(!sealed||!stopped||closers.size||!sealSha256)throw Error('External evidence seal and stopped processes are required.');
      await assertOwner(runChild,runId);await assertOwner(evidenceChild,runId);
      const sealPath=join(evidenceRoot,'run-seal.json'),sealStat=await lstat(sealPath);
      if(!sealStat.isFile()||sealStat.isSymbolicLink()||sealStat.nlink>1)throw Error('Evidence seal file is unsafe.');
      const sealBytes=await readFile(sealPath);if(sha(sealBytes)!==sealSha256)throw Error('Evidence seal changed after sealing.');
      const seal=JSON.parse(sealBytes.toString()) as Seal;
      if(seal.schemaVersion!==1||seal.runId!==runId||seal.parentRoot!==parentRoot||seal.evidenceRoot!==evidenceRoot||!seal.inventories)throw Error('Evidence seal identity changed.');
      for(const child of children.values())await assertOwner(child,runId);
      if(!seal.projects||!seal.files||canonicalJson(seal.projects)!==canonicalJson(await snapshotsFromChildren(children))||canonicalJson(seal.projects)!==canonicalJson(await snapshotNamedProjects(parentRoot,seal.projects)))throw Error('Owned project snapshot changed after sealing.');
      await assertInventory(parentRoot,seal.inventories.parentRoot);
      for(const child of children.values()){await assertOwner(child,runId);const expected=seal.inventories.projects[child.name];if(!expected)throw Error('Evidence seal is missing a project inventory.');await assertInventory(child.path,expected);}
      if(canonicalJson(seal.inventories.installQuarantines)!==canonicalJson(Object.fromEntries(installQuarantines)))throw Error('Delivery quarantine seal registration changed.');
      for(const [name,inventory] of installQuarantines)await assertInventory(join(parentRoot,name),inventory);
      await assertInventory(filesRoot,seal.inventories.files);
      for(const [name,area] of evidenceAreas){const expected=seal.inventories.evidenceAreas[name];if(!expected)throw Error('Evidence seal is missing an evidence area inventory.');await assertInventory(area.path,expected);}
      await assertInventory(evidenceRoot,seal.inventories.evidenceRoot,['run-seal.json']);await verifyEvidenceFiles(evidenceRoot,seal.files);
      const nested=new Map<string,Inventory>();for(const child of children.values())nested.set(child.name,seal.inventories.projects[child.name]!);
      for(const [name,inventory] of installQuarantines)nested.set(name,inventory);
      await removeRegisteredRoot(parentRoot,seal.inventories.parentRoot,nested);cleaned=true;
    },
    async abortForTest(options={}){
      if(cleaned)return;await run.stopOwnedProcesses();await assertOwner(runChild,runId);await assertOwner(evidenceChild,runId);
      for(const child of children.values())await assertOwner(child,runId);
      const parentInventory=registered.get(parentRoot),evidenceInventory=registered.get(evidenceRoot),filesInventory=registered.get(filesRoot);
      if(!parentInventory||!evidenceInventory||!filesInventory)throw Error('Owned cleanup registration is missing.');
      for(const [path,inventory] of registered)await assertInventory(path,inventory);
      const projectInventories=new Map<string,Inventory>();for(const child of children.values()){const inventory=registered.get(child.path);if(!inventory)throw Error('Owned project cleanup registration is missing.');projectInventories.set(child.name,inventory);}
      for(const [name,inventory] of installQuarantines)projectInventories.set(name,inventory);
      await removeRegisteredRoot(parentRoot,parentInventory,projectInventories);
      if(!options.preserveEvidence){
        const evidenceNested=new Map<string,Inventory>([['files',filesInventory]]);
        for(const [name,area] of evidenceAreas){const inventory=registered.get(area.path);if(!inventory)throw Error('Evidence area cleanup registration is missing.');evidenceNested.set(name,inventory);}
        await removeRegisteredRoot(evidenceRoot,evidenceInventory,evidenceNested);
      }
      cleaned=true;
    }
  };
  return run;
}async function snapshotsFromChildren(children:Map<string,OwnedChild>){const result:Record<string,ProjectEntry[]>={};for(const child of children.values())result[child.name]=await fileSnapshot(child.path);return result;}
async function snapshotNamedProjects(parentRoot:string,projects:Record<string,ProjectEntry[]>){const result:Record<string,ProjectEntry[]>={};for(const name of Object.keys(projects))result[name]=await fileSnapshot(join(parentRoot,name));return result;}

export async function installFrozenCli(options:{run:OwnedRun;tarballPath:string;nodeExecutable:string;npmCliPath:string;expectedVersion:string;expectedTarballSha256:string;registry?:string}){
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.expectedVersion))throw Error('Expected frozen CLI version is invalid.');
  if(!/^[0-9a-f]{64}$/.test(options.expectedTarballSha256))throw Error('Expected frozen CLI tarball digest is invalid.');
  const tarballPath=resolve(options.tarballPath),tarballStat=await lstat(tarballPath);
  if(!tarballStat.isFile()||tarballStat.isSymbolicLink()||tarballStat.nlink>1)throw Error('Frozen CLI tarball must be an ordinary file.');
  const tarball=await readFile(tarballPath),tarballSha256=sha(tarball);
  if(tarballSha256!==options.expectedTarballSha256)throw Error('Frozen CLI tarball bytes do not match expected digest.');
  const root=await options.run.makeOwnedProject('cli-consumer');
  await writeFile(join(root,'package.json'),json({name:'t17-frozen-cli-consumer',version:'1.0.0',private:true,dependencies:{'@company/component-cli':pathToFileURL(tarballPath).href}}),{flag:'wx'});
  await options.run.registerOwnedPath(root,['package.json']);
  const area=await options.run.createEvidenceArea('cli-install'),userconfig=join(area,'npm-userconfig'),globalconfig=join(area,'npm-globalconfig'),cache=join(area,'npm-cache');
  await writeFile(userconfig,'',{flag:'wx'});await writeFile(globalconfig,'',{flag:'wx'});await mkdir(cache);const cacheIdentity=await objectIdentity(cache);
  const cp=await import('node:child_process'),env:NodeJS.ProcessEnv={PATH:dirname(resolve(options.nodeExecutable)),TEMP:cache,TMP:cache,CI:'true',npm_config_userconfig:userconfig,npm_config_globalconfig:globalconfig,npm_config_cache:cache};
  let out='';
  try {out=await new Promise<string>((ok,fail)=>{
    const child=cp.spawn(resolve(options.nodeExecutable),[resolve(options.npmCliPath),'install','--ignore-scripts','--no-audit','--no-fund','--registry',options.registry??'https://registry.npmjs.org/','--prefix',root],{cwd:root,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let text='';let spawnError:Error|undefined,timedOut=false,unregister=()=>{};child.stdout.on('data',b=>text+=String(b));child.stderr.on('data',b=>text+=String(b));
    const closed=new Promise<void>(resolveClose=>child.once('close',()=>resolveClose())),timer=setTimeout(()=>{timedOut=true;child.kill();},600000);
    unregister=options.run.trackOwnedProcess(async()=>{if(child.exitCode===null)child.kill();await closed;clearTimeout(timer);});
    child.once('error',error=>{spawnError=error;});
    child.once('close',(code,signal)=>{clearTimeout(timer);unregister();if(timedOut)fail(Error('Frozen CLI install timed out after the process exited.'));else if(spawnError)fail(Error('Frozen CLI install could not start ('+spawnError.name+').'));else if(code===0)ok(text);else fail(Error('Frozen CLI install exited '+code+' ('+String(signal)+'): '+text.slice(-1000)));});
  });} finally {
    try {
      const projectPaths=['package.json'];for(const name of ['package-lock.json','node_modules','tarball-reference.txt'])try{await lstat(join(root,name));projectPaths.push(name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      await options.run.registerOwnedPath(root,projectPaths);
    } finally {
      await removeDisposableCache(cache,area,cacheIdentity);
      await options.run.registerEvidenceAreaContents(area,['npm-userconfig','npm-globalconfig']);
    }
  }
  if(sha(await readFile(tarballPath))!==tarballSha256)throw Error('Frozen CLI tarball changed during install.');
  const manifestPath=join(root,'node_modules/@company/component-cli/package.json'),pkg=JSON.parse(await readFile(manifestPath,'utf8')) as {name?:string;version?:string;bin?:string|Record<string,string>};
  if(pkg.name!=='@company/component-cli'||pkg.version!==options.expectedVersion)throw Error('Installed CLI package identity or frozen version mismatch.');
  const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.component;if(!bin)throw Error('Installed CLI manifest lacks component bin.');
  const entry=resolve(root,'node_modules/@company/component-cli',bin);if(!inside(await realpath(root),await realpath(entry)))throw Error('Installed CLI entry escapes external consumer.');
  return{root,entry,entrySha256:sha(await readFile(entry)),version:pkg.version,tarballSha256,tarballBytes:tarball.length,manifestSha256:sha(await readFile(manifestPath)),installOutputBytes:Buffer.byteLength(out)};
}

export type BuiltImportEvidenceInput={projectRoot:string;generatedPath:string;emittedEntry:string;sourceMapPath:string;viteModules:string[];host:BuiltHost;loadedAssets:{url:string;path:string;sha256:string;bytes:number;status:number}[];emittedAssetSha256:string};
export async function verifyBuiltImportEvidence(input:BuiltImportEvidenceInput){const ownedAssets=builtHosts.get(input.host);if(!ownedAssets)throw Error('Loopback host handle is not owned by this acceptance run.');const root=await realpath(input.projectRoot),generated=resolve(root,input.generatedPath),generatedStat=await lstat(generated),generatedReal=await realpath(generated);if(!inside(root,generated)||!inside(root,generatedReal)||!generatedStat.isFile()||generatedStat.isSymbolicLink()||generatedStat.nlink>1)throw Error('Generated module escapes project root or is not an ordinary file.');const graphFiles=await Promise.all(input.viteModules.map(async id=>{const file=id.split('?')[0]!;if(!isAbsolute(file))throw Error('Vite graph entries must use absolute file paths.');return realpath(file).catch(()=>undefined);}));if(!graphFiles.includes(generatedReal))throw Error('Vite graph omitted the exact generated module.');const mapPath=resolve(root,input.sourceMapPath);if(!inside(root,mapPath))throw Error('Build source map escapes project root.');const mapStat=await lstat(mapPath);if(!mapStat.isFile()||mapStat.isSymbolicLink()||mapStat.nlink>1||!inside(root,await realpath(mapPath)))throw Error('Build source map must be an ordinary project file.');const mapBytes=await readFile(mapPath),map=JSON.parse(mapBytes.toString()) as {sourceRoot?:string;sources?:unknown};if(!Array.isArray(map.sources)||!map.sources.every(source=>typeof source==='string'))throw Error('Build source map has invalid sources.');const mapped=await Promise.all((map.sources as string[]).map(async source=>{const path=resolve(dirname(mapPath),map.sourceRoot??'',source);if(!inside(root,path))return undefined;return realpath(path).catch(()=>undefined);}));if(!mapped.includes(generatedReal))throw Error('Build source map omitted the exact generated module.');const entryPath=resolve(root,input.emittedEntry);if(!inside(root,entryPath))throw Error('Emitted entry escapes project root.');const emittedReal=await realpath(entryPath).catch(()=>undefined);if(!emittedReal||!inside(root,emittedReal))throw Error('Emitted bundle is missing or escapes project root.');const emittedStat=await lstat(entryPath);if(!emittedStat.isFile()||emittedStat.isSymbolicLink()||emittedStat.nlink>1)throw Error('Emitted bundle is not an ordinary file.');const emittedBytes=await readFile(entryPath),actualSha=sha(emittedBytes);if(!/^[0-9a-f]{64}$/.test(input.emittedAssetSha256)||actualSha!==input.emittedAssetSha256)throw Error('Emitted bundle digest differs from actual dist bytes.');const loadedPath='/'+input.emittedEntry.replace(/^dist[\/]/,'').replaceAll('\\','/'),loaded=input.loadedAssets.find(asset=>asset.path===loadedPath);if(!loaded||loaded.status!==200||loaded.bytes!==emittedBytes.length||loaded.sha256!==actualSha)throw Error('Browser-loaded bytes differ from tested build asset.');const url=new URL(loaded.url),hostUrl=new URL(input.host.url),served=ownedAssets.get(loadedPath);if(url.username||url.password||url.search||url.hash||url.origin!==hostUrl.origin||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!==loadedPath||!served||served.sha256!==actualSha||served.bytes!==emittedBytes.length||served.path!==loadedPath)throw Error('Browser-loaded asset is not bound to the owned loopback host served bytes.');return{generatedPath:input.generatedPath.replaceAll('\\','/'),generatedModuleIncluded:true,sourceMapContainsGeneratedModule:true,emittedEntry:input.emittedEntry,emittedAssetSha256:actualSha,browserLoadedBuiltAsset:true,loopbackUrl:loaded.url};}
const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.woff2':'font/woff2'};
export async function startBuiltHost(options:{projectRoot:string;run:OwnedRun}):Promise<BuiltHost>{const projectRoot=await realpath(options.projectRoot);if(!Object.values(options.run.projectRoots).some(path=>resolve(path)===projectRoot))throw Error('Built host project is not one of the owned Vue/React roots.');const distPath=join(projectRoot,'dist'),distStat=await lstat(distPath);if(!distStat.isDirectory()||distStat.isSymbolicLink()||distStat.nlink>1)throw Error('Built output must be a real project-owned directory.');const root=await realpath(distPath);if(!inside(projectRoot,root))throw Error('Built output escapes project root.');const servedAssets=new Map<string,{path:string;sha256:string;bytes:number}>(),server:Server=createServer((req,res)=>{void(async()=>{if(req.method!=='GET'){res.writeHead(405);res.end();return;}let pathname:string;try{pathname=decodeURIComponent(new URL(req.url??'/','http://127.0.0.1').pathname);}catch{res.writeHead(400);res.end();return;}const rel=(pathname==='/'?'/index.html':pathname).replace(/^\/+/,''),target=resolve(root,rel);if(!inside(root,target)){res.writeHead(403);res.end();return;}let st;try{st=await lstat(target);}catch{res.writeHead(404);res.end();return;}if(!st.isFile()||st.isSymbolicLink()||st.nlink>1||await realpath(target)!==target){res.writeHead(403);res.end();return;}const bytes=await readFile(target);servedAssets.set('/'+rel,{path:'/'+rel,sha256:sha(bytes),bytes:bytes.length});res.writeHead(200,{'content-type':MIME[extname(target)]??'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);})().catch(()=>{res.writeHead(500);res.end();});});await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});const address=server.address();if(!address||typeof address==='string')throw Error('Loopback host did not bind.');let closed=false;const close=async()=>{if(closed)return;closed=true;const done=new Promise<void>((ok,fail)=>server.close(error=>error?fail(error):ok()));server.closeAllConnections();await done;};const unregister=options.run.trackOwnedProcess(close),host:BuiltHost={url:'http://127.0.0.1:'+address.port+'/',get servedAssets(){return new Map(servedAssets);},close:async()=>{await close();unregister();}};builtHosts.set(host,servedAssets);return host;}
