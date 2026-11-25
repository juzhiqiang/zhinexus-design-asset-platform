import {copyFile,mkdir,readdir} from 'node:fs/promises';
const source=new URL('../src/workbench/ui/',import.meta.url),target=new URL('../dist/workbench/ui/',import.meta.url);
const assets=['client.js','index.html','style.css'];
const files=(await readdir(source)).sort();
if(JSON.stringify(files)!==JSON.stringify(assets))throw new Error('WORKBENCH_ASSETS: 请显式登记全部工作台资源');
await mkdir(target,{recursive:true});
for(const file of assets)await copyFile(new URL(file,source),new URL(file,target));
