import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the real dispatcher AND worker message handler; only COG IO is replaced.
// This catches missing payload fields, silent unmasked fallbacks and double correction.
function harness(samples) {
 const reads=[], jobs=[];
 function load(name, extras={}, cache=new Map()) {
  if(cache.has(name)) return cache.get(name);
  const exports={}; cache.set(name,exports);
  const source=readFileSync(new URL(`./${name}.ts`,import.meta.url),'utf8').replaceAll('import.meta.url',JSON.stringify(import.meta.url));
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{exports,URL,setTimeout,clearTimeout,console,...extras,require(id){
   if(id==='./cog') return {sampleTile:async(href,...coords)=>{
    reads.push({href,coords});
    if(samples[href] instanceof Error)throw samples[href];
    if(!samples[href])throw Error(`missing fixture ${href}`);
    return {bands:samples[href].map(x=>Float32Array.from(x))};
   },colormap:(_name,v)=>[v*255,(1-v)*255,128]};
   return load(id.slice(2),extras,cache);
  }});
  return exports;
 }
 class Worker {
  constructor(){
   const self={fetch:async()=>{},postMessage:(data)=>this.onmessage({data})};
   load('cog.worker',{self});this.self=self;
  }
  postMessage(job){jobs.push(job);void this.self.onmessage({data:job});}
 }
 const api=load('imagery',{Worker,navigator:{hardwareConcurrency:4}});
 const item={id:'fixture',properties:{'proj:epsg':32654,'s2:processing_baseline':'05.00','earthsearch:boa_offset_applied':false},assets:Object.fromEntries(['nir','red','green','nir08','swir16','visual','scl'].map(k=>[k,{href:k}]))};
 return {api,item,reads,jobs};
}
const render=(h,mode)=>h.api.renderTile(h.item,mode,1,12,3663,1500,4);
const band=v=>Array(16).fill(v);
test('raster dispatcher applies scene-specific offset once for NDVI/NDWI/NDMI',async()=>{
 for(const [id,a,b] of [['ndvi','nir','red'],['ndwi','green','nir'],['ndmi','nir08','swir16']]) {
  for(const [props,offset] of [[{'s2:processing_baseline':'05.00'},1000],[{'earthsearch:boa_offset_applied':true,'s2:processing_baseline':'05.00'},0],[{'s2:processing_baseline':'03.00'},0],[{},0]]) {
   const h=harness({[a]:[band(4000)],[b]:[band(2000)],scl:[band(4)]});h.item.properties={'proj:epsg':32654,...props};
   const rgba=await render(h,{kind:'index',id});
   assert.equal(h.jobs[0].dnOffset,offset);assert.equal(h.jobs[0].sclHref,'scl');
   const expected=h.api.indexFromDn(h.item,4000,2000);
   assert.equal(rgba[0],Math.round((expected+1)/2*255));assert.equal(rgba[3],255);
   assert.equal(rgba.length,4*4*4);
   assert.deepEqual(h.reads.find(r=>r.href==='scl').coords,[32654,12,3663,1500,4]);
  }
 }
});
test('invalid SCL classes and missing pixels become transparent; dark/unclassified remain',async()=>{
 const classes=[0,1,2,3,4,5,6,7,8,9,10,11,255,NaN,4,4];
 const a=band(4000),b=band(2000);a[14]=NaN;a[15]=500;b[15]=500;
 const h=harness({nir:[a],red:[b],scl:[classes]});
 const rgba=await render(h,{kind:'index',id:'ndvi'});
 assert.deepEqual(Array.from({length:16},(_,i)=>rgba[i*4+3]),classes.map((c,i)=>[2,4,5,6,7].includes(c)&&i<14?255:0));
});
test('SCL read failure rejects instead of returning an unmasked successful tile',async()=>{
 const samples={nir:[band(4000)],red:[band(2000)],scl:new Error('SCL network failure')};
 const h=harness(samples);
 await assert.rejects(render(h,{kind:'index',id:'ndvi'}),/SCL network failure/);
 samples.scl=[band(4)];
 const retry=await render(h,{kind:'index',id:'ndvi'});assert.equal(retry[3],255);
});
test('absent SCL retains index calculation without requesting nonexistent asset',async()=>{
 const h=harness({nir:[band(4000)],red:[band(2000)]});delete h.item.assets.scl;
 const rgba=await render(h,{kind:'index',id:'ndvi'});
 assert.equal(rgba[3],255);assert.equal(h.reads.length,2);
});
test('true colour composites keep byte-identical unmasked rendering regardless of offset and SCL',async()=>{
 const values=Array.from({length:16},(_,i)=>i+10);
 const h=harness({visual:[values,values,values],scl:new Error('must not read')});
 const rgba=await render(h,{kind:'composite',id:'tci'});
 assert.deepEqual(Array.from(rgba),values.flatMap(v=>[v,v,v,255]));
 assert.deepEqual(h.reads.map(r=>r.href),['visual']);assert.equal(h.jobs[0].dnOffset,undefined);
});
