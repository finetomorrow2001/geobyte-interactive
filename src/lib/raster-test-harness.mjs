import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the real dispatcher AND worker message handler; only COG IO is replaced.
// This catches missing payload fields, silent unmasked fallbacks and double correction.
export function harness(samples, {beforeRead, colormap = (_name,v)=>[v*255,(1-v)*255,128], environment = {}} = {}) {
 const reads=[], jobs=[];
 function load(name, extras={}, cache=new Map()) {
  if(cache.has(name)) return cache.get(name);
  const exports={}; cache.set(name,exports);
  const source=readFileSync(new URL(`./${name}.ts`,import.meta.url),'utf8').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{exports,URL,setTimeout,clearTimeout,console,...extras,require(id){
   if(id==='./cog') return {sampleTile:async(href,...coords)=>{
    reads.push({href,coords});
    await beforeRead?.(href);
    if(samples[href] instanceof Error)throw samples[href];
    if(!samples[href])throw Error(`missing fixture ${href}`);
    return {bands:samples[href].map(x=>Float32Array.from(x))};
   },colormap};
   return load(id.slice(2),extras,cache);
  }});
  return exports;
 }
 class Worker {
  constructor(){
   const self={fetch:async()=>{},postMessage:(data)=>this.onmessage({data})};
   load('cog.worker',{self,...environment});this.self=self;
  }
  postMessage(job){jobs.push(job);void this.self.onmessage({data:job});}
 }
 const api=load('imagery',{Worker,navigator:{hardwareConcurrency:4},...environment});
 const item={id:'fixture',properties:{'proj:epsg':32654,'s2:processing_baseline':'05.00','earthsearch:boa_offset_applied':false},assets:Object.fromEntries(['nir','red','green','nir08','swir16','visual','scl'].map(k=>[k,{href:k}]))};
 return {api,item,reads,jobs};
}

// Compile only the real colormap declarations, keeping network IO out of fixtures.
const cogSource=readFileSync(new URL('./cog.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('cog.ts',cogSource,ts.ScriptTarget.Latest,true);
const mapSource=ast.statements.filter(n=>
 (ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='colormaps'))||
 (ts.isFunctionDeclaration(n)&&n.name?.text==='colormap')
).map(n=>n.getText(ast)).join('\n');
const mapExports={};
vm.runInNewContext(ts.transpileModule(mapSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:mapExports});
export const actualColormap=mapExports.colormap;
