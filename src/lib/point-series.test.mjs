import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';

// Execute the production component functions, with deferred I/O to exercise races.
const page=await fs.readFile(new URL('../routes/imagery/+page.svelte',import.meta.url),'utf8');
const script=page.split('<script lang="ts">')[1].split('</script>')[0];
const ast=ts.createSourceFile('component.ts',script,ts.ScriptTarget.Latest,true);
const functions=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&['buildSeries','refreshSeries'].includes(s.name?.text)).map(s=>s.getText(ast)).join('\n');
assert.equal(ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&['buildSeries','refreshSeries'].includes(s.name?.text)).length,2);
function harness(){
 const pending=[];
 const context=vm.createContext({readPoint:(...args)=>new Promise((resolve,reject)=>pending.push({args,resolve,reject})),maskOf:r=>r.reason??null,indexFromDn:(_item,a,b)=>(a-b)/(a+b)});
 const source=`let point={lon:-97.512,lat:30.197},seriesVersion=0,seriesLoading=false,series=[],seriesIndex='ndvi',seriesSource='items',error='';
 let items=[{id:'scene',properties:{datetime:'2026-10-22T17:15:28Z'}}],yearly=[];
 const indices=[{id:'ndvi',b1:'nir',b2:'red'},{id:'ndmi',b1:'nir',b2:'swir16'}];
 ${functions}
 globalThis.api={buildSeries,refreshSeries,setIndex:x=>seriesIndex=x,setSource:x=>seriesSource=x,state:()=>({seriesLoading,seriesIndex,seriesSource,error,series})};`;
 vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
 return {api:context.api,pending};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('changing the selected index during calculation cannot publish old-index values',async()=>{
 const {api,pending}=harness(); const old=api.buildSeries();
 api.setIndex('ndmi'); api.refreshSeries();
 assert.equal(pending.length,2);assert.deepEqual([...pending[1].args[3]],['nir','swir16']);
 pending[0].resolve({vals:{nir:6,red:2}});await old;
 assert.equal(api.state().series.length,0);assert.equal(api.state().seriesLoading,true);
 pending[1].resolve({vals:{nir:6,swir16:4}});await flush();
 assert.equal(api.state().series[0].v,.2);assert.equal(api.state().seriesLoading,false);
});
test('switching to an empty source invalidates pending values and errors',async()=>{
 for(const fail of [false,true]){
  const {api,pending}=harness(); const old=api.buildSeries();
  api.setSource('yearly');api.refreshSeries();
  if(fail)pending[0].reject(Error('old-source failure'));else pending[0].resolve({vals:{nir:6,red:2}});
  await old;assert.equal(api.state().series.length,0);assert.equal(api.state().error,'');assert.equal(api.state().seriesLoading,false);
 }
});
test('index selection before the first computation remains manual; masked values stay missing',async()=>{
 const {api,pending}=harness();api.setIndex('ndmi');api.refreshSeries();assert.equal(pending.length,0);
 const done=api.buildSeries();pending[0].resolve({reason:'cloud',vals:{nir:6,swir16:4}});await done;
 assert.equal(api.state().series[0].v,null);assert.equal(api.state().series[0].reason,'cloud');
});
