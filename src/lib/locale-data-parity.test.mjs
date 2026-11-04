import nodeTest, {after} from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const outcomes=new Map();
const test=(name,fn)=>nodeTest(name,async(t)=>{const id=name.slice(0,5);try{await fn(t);outcomes.set(id,{status:'PASS'});}catch(e){outcomes.set(id,{status:'FAIL',error:e.message});throw e;}});
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileModule} from 'svelte/compiler';
import ts from 'typescript';
import {harness,actualColormap} from './raster-test-harness.mjs';
const evidence=[];
after(()=>{if(process.env.SDL_LOCALE_REPORT){const scientific=['cog.ts','cog.worker.ts','imagery.ts','reflectance.ts','scl.ts','annual.ts'];writeFileSync(process.env.SDL_LOCALE_REPORT,JSON.stringify({environment:'Node + actual Svelte-compiled locale module; mocked browser/storage/STAC/COG IO; real worker and colormap. NOT rendered UI.',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../..',import.meta.url))}).toString().trim(),goldenBaseline:'36689d65663eb6a3ed3088f4d7a07e17fada82d5',sourceHashes:Object.fromEntries(scientific.map(n=>[n,createHash('sha256').update(readFileSync(new URL('./'+n,import.meta.url))).digest('hex')])),outcomes:Object.fromEntries(Array.from({length:12},(_,i)=>{const id='LP-'+String(i+1).padStart(2,'0');return [id,outcomes.get(id)??{status:'NOT_RUN'}];})),cases:evidence},null,2));}});

const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const source=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const localeUrl=data(compile(source('./i18n/locale.ts')));
const sclUrl=data(compile(source('./scl.ts')));
const annual=await import(data(compile(source('./annual.ts')).replace("from './scl.ts'",'from '+JSON.stringify(sclUrl))));
const {imagery:dict}=await import(data(compile(source('./i18n/imagery.ts'))));
let serial=0;
async function languageEnvironment({href='https://fixture.test/imagery?lang=ja',saved='en',disabled=false,navigatorLanguage='ja-JP',browser=true}={}) {
 const descriptors=Object.fromEntries(['location','localStorage','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const writes=[],store=new Map(saved==null?[]:[['sdl-lang',saved]]);
 for(const [key,value] of Object.entries({location:{href},document:{documentElement:{lang:''}},navigator:{language:navigatorLanguage},localStorage:{getItem:k=>{if(disabled)throw Error('storage disabled');return store.get(k)??null;},setItem:(k,v)=>{if(disabled)throw Error('storage disabled');writes.push([k,v]);store.set(k,v);}}}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 const js=compile(source('./i18n/lang.svelte.ts')).replace("import { browser } from '$app/environment';",'const browser = '+browser+';').replace("from './locale'",'from '+JSON.stringify(localeUrl));
 if(disabled==='property')Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('storage unavailable');}});
 const compiled=compileModule(js,{filename:'lang.svelte.js',generate:'client'}).js.code.replace("from 'svelte/internal/client'",'from '+JSON.stringify(import.meta.resolve('svelte/internal/client')));
 const api=await import(data(compiled+'\n// isolated fixture '+serial++));
 return {...api,writes,store,restore(){for(const [k,d] of Object.entries(descriptors)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};
}
const band=n=>Array(16).fill(n);
const json=v=>JSON.parse(JSON.stringify(v));
const cleanJob=job=>{const {id,...rest}=job;return json(rest);};

test('LP-01 actual locale state changes do not dispatch or alter NDVI/NDWI/NDMI raw jobs, pixels, offsets or SCL masks',async()=>{
 const l=await languageEnvironment();
 try {
  for(const [index,a,b] of [['ndvi','nir','red'],['ndwi','green','nir'],['ndmi','nir08','swir16']]) {
   for(const [props,expectedOffset] of [[{'s2:processing_baseline':'05.00','earthsearch:boa_offset_applied':false},1000],[{'s2:processing_baseline':'05.00','earthsearch:boa_offset_applied':true},0],[{'s2:processing_baseline':'03.00'},0],[{},0]]) {
    const first=band(4000);first[0]=2000;
    const h=harness({[a]:[first],[b]:[band(2000)],scl:[[4,4,3,8,11,0,1,10,2,5,6,7,255,NaN,4,4]]});
    h.item.properties={'proj:epsg':32654,datetime:'2026-10-23T01:35:00Z',...props};
    const original=json(h.item),rows=[];
    const t=l.makeT(dict);const labels=[];
    for(const lang of ['ja','en','ja']) {
     const count=h.jobs.length;l.setLang(lang);assert.equal(l.i18n.lang,lang);assert.equal(l.store.get('sdl-lang'),lang);labels.push(t('mask_snow'));assert.equal(h.jobs.length,count,'locale alone must not submit jobs');
     const rgba=await h.api.renderTile(h.item,{kind:'index',id:index},1,12,3664,1505,4);
     rows.push({job:cleanJob(h.jobs.at(-1)),rgba:Array.from(rgba),zero:h.api.indexFromDn(h.item,2000,2000),missing:h.api.indexFromDn(h.item,null,2000),value:h.api.indexFromDn(h.item,4000,2000)});
     assert.equal(rows.at(-1).job.dnOffset,expectedOffset);assert.equal(rows.at(-1).zero,0);assert.equal(rows.at(-1).missing,null);
     assert.equal(rgba[3],255);assert.equal(rgba[2*4+3],0);assert.equal(rgba[8*4+3],255);
    }
    assert.notEqual(labels[0],labels[1]);assert.equal(labels[0],labels[2]);
    assert.ok(Math.abs(rows[0].value-(rows[0].job.dnOffset===1000?0.5:1/3))<1e-15);
    assert.deepEqual(rows[0],rows[1]);assert.deepEqual(rows[1],rows[2]);assert.deepEqual(json(h.item),original);
    evidence.push({case:'LP-01',index,props,locales:['ja','en','ja'],labels,raw:rows});
   }
  }
  assert.ok(l.writes.every(([k])=>k==='sdl-lang'));
 }finally{l.restore();}
});

test('LP-02 ja-en-ja during an in-flight render retains its payload, result and Japanese user data',async()=>{
 const l=await languageEnvironment();let release;const gate=new Promise(r=>release=r);
 try {
  const h=harness({nir:[band(4000)],red:[band(2000)],scl:[band(4)]},{beforeRead:()=>gate});
  h.item.properties.name='保存';h.item.properties.notes='表示言語 か\u3099 カナ 🌾 全角Ａ\n魚沼のメモ 0 と欠測は別';h.item.properties.updated_at='2026-10-23T23:59:59Z';
  const original=json(h.item);const rendering=h.api.renderTile(h.item,{kind:'index',id:'ndvi'},1,12,3664,1505,4);
  let finished=false;rendering.then(()=>finished=true);assert.ok(h.reads.length>0);assert.equal(finished,false);const job=json(h.jobs[0]);l.setLang('en');l.setLang('ja');
  assert.equal(h.jobs.length,1);assert.deepEqual(json(h.jobs[0]),job);release();
  const rgba=await rendering;assert.equal(rgba[3],255);assert.deepEqual(json(h.item),original);
  assert.equal(l.i18n.lang,'ja');assert.equal(document.documentElement.lang,'ja');evidence.push({case:'LP-02',jobs:h.jobs.length,reads:h.reads.length,item:original,job,rgba:Array.from(rgba)});
 }finally{release();l.restore();}
});

const geometry={type:'Polygon',coordinates:[[[141,42],[143,42],[143,44],[141,44],[141,42]]]};
const fixture=(id,datetime,cloud)=>({id,bbox:[141,42,143,44],geometry,properties:{datetime,'eo:cloud_cover':cloud,name:'夕張試験林',notes:'変更しない'},assets:{}});
const options={monthDay:'10-23',years:2,maxCloud:30,tolerance:14,allowMissing:false,now:new Date('2026-11-04T00:00:00Z')};

test('LP-03 annual IDs, dates, zero offsets, alternatives and missing reasons are locale invariant',async()=>{
 const l=await languageEnvironment();
 try {
  const rows=[fixture('exact','2025-10-23T01:35:00Z',0),fixture('near','2025-10-24T01:35:00Z',10)];const original=json(rows);const results=[];
  for(const lang of ['ja','en','ja']){
   l.setLang(lang);results.push(json([
    annual.chooseAnnual(rows,2025,options),annual.chooseAnnual([fixture('cloud','2025-10-23T01:35:00Z',90),rows[1]],2025,options),
    annual.chooseAnnual([rows[1]],2025,options),annual.chooseAnnual([rows[1]],2025,{...options,allowMissing:true}),
    annual.chooseAnnual([fixture('unknown','2025-10-23T01:35:00Z',undefined)],2025,options)
   ]));
  }
  assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
  assert.deepEqual(results[0].map(r=>[r.item?.id??null,r.offset,r.reason]),[['exact',0,'exact'],['near',1,'cloud-adjusted'],[null,null,'no-acquisition'],['near',1,'no-acquisition-adjusted'],[null,null,'quality-unknown']]);
  assert.deepEqual(json(rows),original);evidence.push({case:'LP-03',locales:['ja','en','ja'],results});
 }finally{l.restore();}
});

test('LP-04 fixed-clock mocked STAC search has identical locale-independent request bodies and results',async()=>{
 const l=await languageEnvironment();const old=globalThis.fetch;
 try{
  const outputs=[];
  for(const lang of ['ja','en','ja']){
   l.setLang(lang);const requests=[];
   globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);requests.push({url,method:init.method,headers:init.headers,body});const year=body.datetime.slice(0,4);return {ok:true,json:async()=>({features:[fixture('scene-'+year,year+'-10-23T01:35:00Z',0)],links:[]})};};
   const result=await annual.searchAnnual([141.99,42.91,142.075,42.98],options);outputs.push(json({requests,result}));
  }
  assert.deepEqual(outputs[0],outputs[1]);assert.deepEqual(outputs[1],outputs[2]);
  assert.deepEqual(outputs[0].result.map(r=>r.item.id),['scene-2025','scene-2026']);
  assert.ok(outputs[0].requests.every(r=>r.body.datetime.endsWith('Z')&&!('lang' in r.body)));evidence.push({case:'LP-04',outputs});
 }finally{globalThis.fetch=old;l.restore();}
});

test('LP-05 storage, explicit URL precedence, reload and disabled storage use actual compiled locale state',async()=>{
 for(const [href,saved,expected] of [['https://fixture.test/imagery?lang=en','ja','en'],['https://fixture.test/imagery?lang=ja','en','ja'],['https://fixture.test/imagery?lang=fr','en','en'],['https://fixture.test/field','en','en']]){
  const l=await languageEnvironment({href,saved});try{assert.equal(l.i18n.lang,expected);l.setLang(expected);assert.equal(l.store.get('sdl-lang'),expected);}finally{l.restore();}
 }
 for(const disabled of [true,'property']){const l=await languageEnvironment({href:'https://fixture.test/imagery?lang=en',disabled});try{l.setLang('ja');l.setLang('en');assert.equal(l.i18n.lang,'en');assert.equal(document.documentElement.lang,'en');}finally{l.restore();}}
 for(const [navigatorLanguage,expected] of [['ja-JP','ja'],['en-US','en'],['','en']]){const l=await languageEnvironment({href:'https://fixture.test/imagery',saved:null,navigatorLanguage});try{assert.equal(l.i18n.lang,expected);}finally{l.restore();}}
 const ssr=await languageEnvironment({browser:false,href:'https://fixture.test/imagery?lang=en'});try{assert.equal(ssr.i18n.lang,'ja');}finally{ssr.restore();}
 evidence.push({case:'LP-05',cases:['explicit en','explicit ja','invalid query preserves saved en','saved en without query','storage method throws','storage property throws','browser ja-JP','browser en-US','empty browser language','SSR ja'],status:'PASS'});
});

test('LP-06 translated missing/error/SCL labels differ while numeric zero formatting remains zero',async()=>{
 const l=await languageEnvironment();const t=l.makeT(dict);
 try{
  const outputs=[];for(const lang of ['ja','en','ja']){l.setLang(lang);outputs.push({zero:l.nf(0),mask:t('mask_snow'),missing:t('mask_nodata'),error:t('rasterSclMissing','A')});}
  assert.equal(outputs[0].zero,'0');assert.equal(outputs[1].zero,'0');assert.notEqual(outputs[0].mask,outputs[1].mask);assert.notEqual(outputs[0].error,outputs[1].error);evidence.push({case:'LP-06',outputs});
 }finally{l.restore();}
});

// Pinned from the unchanged scientific sources at 36689d6 (not recomputed in
// assertions). Hand vectors: (4000-2000)/(4000+2000)=1/3; subtracting 1000
// yields (3000-1000)/(3000+1000)=1/2; equal nonzero bands yield a valid zero.
const golden={
 'ndvi:0':'c27b79d2b49f8e0b65f57f39c9f1385b54448820b72e2419d997f5dba285e917',
 'ndvi:1000':'03b9d107c1b6efbd42bdffe6e96d9a2b75cf899a5bbe99e15abd17be67ef7793',
 'ndwi:0':'8082bf2418d62eba7b2435eb8dd10e46b481c26d06718f27a4b60dce57be713c',
 'ndwi:1000':'05b1812a7344a5598a46e90df541a9a78cce75ae86606e417ebf43cfa2dc1734',
 'ndmi:0':'4fe029d6d289cf023027cd2b3c30901b874fc0a3a54f7d163682d1bac60fe662',
 'ndmi:1000':'7a2930a250f4182d5ba5890fb74678367424e170180b983256dbd22c94303d11'
};
test('LP-07 both switch directions retain real-colormap golden bytes and hand-calculated indices',async()=>{
 const l=await languageEnvironment();
 try{
  for(const sequence of [['ja','en','ja'],['en','ja','en']])for(const [index,a,b] of [['ndvi','nir','red'],['ndwi','green','nir'],['ndmi','nir08','swir16']])for(const offset of [0,1000]){
   const aa=[2000,4000,2000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,NaN,1000,500],bb=band(2000);bb[14]=1000;bb[15]=500;
   const h=harness({[a]:[aa],[b]:[bb],scl:[[4,4,3,8,11,0,1,10,2,5,6,7,255,4,4,4]]},{colormap:actualColormap});
   h.item.properties={'proj:epsg':32654,'earthsearch:boa_offset_applied':offset===0,'s2:processing_baseline':'05.00'};
   const hashes=[];
   for(const lang of sequence){l.setLang(lang);assert.equal(l.i18n.lang,lang);const rgba=await h.api.renderTile(h.item,{kind:'index',id:index},1,12,3664,1505,4);const hash=createHash('sha256').update(rgba).digest('hex');assert.equal(hash,golden[index+':'+offset]);hashes.push(hash);assert.ok(Math.abs(h.api.indexFromDn(h.item,4000,2000)-(offset?0.5:1/3))<1e-15);assert.equal(rgba[3],255);assert.equal(rgba[13*4+3],0);const mutated=Uint8Array.from(rgba);mutated[0]^=1;assert.throws(()=>assert.equal(createHash('sha256').update(mutated).digest('hex'),golden[index+':'+offset]));}
   evidence.push({case:'LP-07',sequence,index,offset,hashes,golden:golden[index+':'+offset]});
  }
  // Each real rendered tile above is mutated by one byte as the positive control.
 }finally{l.restore();}
});

test('LP-08 compute import closure excludes locale state; guarded runtime rejects a deliberate locale read',async()=>{
 const dependencies=code=>{const ast=ts.createSourceFile('compiled.js',code,ts.ScriptTarget.Latest,true),deps=[];const walk=n=>{if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier)deps.push(n.moduleSpecifier.text);if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||n.expression.getText(ast)==='require')){assert.ok(ts.isStringLiteral(n.arguments[0]),'dynamic module name requires explicit review');deps.push(n.arguments[0].text);}ts.forEachChild(n,walk);};walk(ast);for(const dep of deps)assert.doesNotMatch(dep,/(?:i18n|^\$app)/);return deps;};
 const visited=new Set();const visit=name=>{if(visited.has(name))return;visited.add(name);for(const dep of dependencies(compile(source('./'+name+'.ts'))))if(dep.startsWith('./'))visit(dep.slice(2).replace(/\.ts$/,''));};
 visit('imagery');visit('cog.worker');const modules=[...visited].sort();assert.ok(modules.includes('cog')&&modules.includes('reflectance'));
 assert.throws(()=>dependencies("import {i18n} from './i18n/lang.svelte';"));
 assert.throws(()=>dependencies("export {i18n} from './i18n/lang.svelte';"));
 assert.throws(()=>dependencies("import('./i18n/lang.svelte');"));
 let reads=0;const prohibited=()=>{reads++;throw Error('locale leaked into scientific computation');};
 const navigator={hardwareConcurrency:4};Object.defineProperty(navigator,'language',{get:prohibited});
 const h=harness({nir:[band(4000)],red:[band(2000)],scl:[band(4)]},{environment:{navigator,localStorage:new Proxy({},{get:prohibited}),document:new Proxy({},{get:prohibited})}});
 await h.api.renderTile(h.item,{kind:'index',id:'ndvi'},1,12,3664,1505,4);assert.equal(reads,0);assert.throws(()=>navigator.language,/locale leaked/);assert.equal(reads,1);
 evidence.push({case:'LP-08',modules,scientific_locale_reads:0,positive_control:'caught deliberate import and navigator.language read'});
});

test('LP-09 toggle + URL replacement + fresh locale initialization preserves Unicode, duplicate values and selected locale',async()=>{
 const {languageUrl}=await import(localeUrl);const input='https://fixture.test/imagery?lang=ja&item=S2B_54TWN_20261023_1_L2A&bbox=141.99,42.91,142.075,42.98&name='+encodeURIComponent('保存 表示言語 か\u3099 カナ 🌾 全角Ａ\nメモ')+'&tag=0&tag=&time=2026-10-23T23%3A59%3A59%2B09%3A00#系列';
 const expected=[...new URL(input).searchParams].filter(([k])=>k!=='lang');let href=input;const snapshots=[];
 for(const lang of ['ja','en','ja','en','ja','en']){
  const l=await languageEnvironment({href,saved:'ja'});let saved;
  try{l.setLang(lang);href=new URL(languageUrl(href,lang),'https://fixture.test').href;saved=l.store.get('sdl-lang');assert.deepEqual([...new URL(href).searchParams].filter(([k])=>k!=='lang'),expected);assert.equal(new URL(href).pathname,new URL(input).pathname);assert.equal(new URL(href).hash,new URL(input).hash);snapshots.push({lang,href,saved});}finally{l.restore();}
  const fresh=await languageEnvironment({href,saved});try{assert.equal(fresh.i18n.lang,lang);}finally{fresh.restore();}
  const without=new URL(href);without.searchParams.delete('lang');const stored=await languageEnvironment({href:without.href,saved});try{assert.equal(stored.i18n.lang,lang);}finally{stored.restore();}
 }
 evidence.push({case:'LP-09',snapshots,non_locale_params:expected});
});

test('LP-10 observed error messages are stable; actual point formatting distinguishes missing from zero',async()=>{
 const l=await languageEnvironment();const old=globalThis.fetch;
 try{
  const errors=[];for(const lang of ['ja','en','ja','en']){
   l.setLang(lang);globalThis.fetch=async()=>({ok:false,status:500});let message;
   try{await annual.searchAnnual([141.99,42.91,142.075,42.98],options);}catch(e){message=e.message;}
   assert.equal(message,'STAC 500 (2026)');
   const h=harness({nir:[band(4000)],red:[band(2000)],scl:new Error('SCL HTTP 404')});let sclMessage;try{await h.api.renderTile(h.item,{kind:'index',id:'ndvi'},1,12,3664,1505,4);}catch(e){sclMessage=e.message;}assert.equal(sclMessage,'Error: SCL HTTP 404');errors.push({lang,stac:message,scl:sclMessage});
  }
  const component=ts.createSourceFile('page.ts',source('../routes/imagery/+page.svelte').split('<script lang="ts">')[1].split('</script>')[0],ts.ScriptTarget.Latest,true);
  const node=component.statements.filter(ts.isVariableStatement).flatMap(n=>Array.from(n.declarationList.declarations)).find(d=>d.name.getText(component)==='fmt');
  const fn=ts.transpileModule('exports.fmt = '+node.initializer.getText(component),{compilerOptions:{target:99,module:1}}).outputText;
  const exports={};new Function('exports',fn)(exports);assert.equal(exports.fmt(0),'0.00');assert.equal(exports.fmt(null),'—');assert.notEqual(exports.fmt(null),exports.fmt(0));
  evidence.push({case:'LP-10',errors,formatter:{zero:exports.fmt(0),missing:exports.fmt(null)}});
 }finally{globalThis.fetch=old;l.restore();}
});

test('LP-11 imagery and field dictionary keys and function arity match between languages',async()=>{
 const {fieldDict}=await import(data(compile(source('./i18n/field.ts'))));const counts={};
 for(const [name,dictionary] of Object.entries({imagery:dict,field:fieldDict})){
  assert.deepEqual(Object.keys(dictionary.ja).sort(),Object.keys(dictionary.en).sort());
  for(const key of Object.keys(dictionary.ja)){assert.equal(typeof dictionary.ja[key],typeof dictionary.en[key]);if(typeof dictionary.ja[key]==='function')assert.equal(dictionary.ja[key].length,dictionary.en[key].length);}
  counts[name]=Object.keys(dictionary.ja).length;
 }
 assert.ok(counts.imagery>100&&counts.field>20);evidence.push({case:'LP-11',counts});
});

test('LP-12 UTC acquisition dates, epochs and request windows survive both host timezones',async()=>{
 const l=await languageEnvironment();const old=process.env.TZ,oldFetch=globalThis.fetch,results=[],tzOffsets=[];
 try{
  for(const tz of ['Asia/Tokyo','America/Los_Angeles']){
   process.env.TZ=tz;tzOffsets.push(new Date(2025,9,23,12).getTimezoneOffset());
   for(const lang of ['ja','en']){
    l.setLang(lang);const rows=[fixture('utc-boundary','2025-10-23T23:59:59Z',0)],r=annual.chooseAnnual(rows,2025,options),requests=[];
    globalThis.fetch=async(url,init)=>{requests.push(JSON.parse(init.body));return {ok:true,json:async()=>({features:[],links:[]})};};
    await annual.searchAnnual([141.99,42.91,142.075,42.98],options);
    assert.equal(r.item.id,'utc-boundary');assert.equal(r.offset,0);assert.equal(r.item.properties.datetime,'2025-10-23T23:59:59Z');
    results.push({tz,lang,id:r.item.id,iso:r.item.properties.datetime,epoch:Date.parse(r.item.properties.datetime),offset:r.offset,requests});
   }
  }
  assert.notEqual(tzOffsets[0],tzOffsets[1]);assert.deepEqual(tzOffsets,[-540,420]);
  assert.ok(results.every(r=>r.epoch===Date.parse('2025-10-23T23:59:59Z')));
  for(const r of results)assert.deepEqual(r.requests,results[0].requests);
  evidence.push({case:'LP-12',tzOffsets,results});
 }finally{globalThis.fetch=oldFetch;if(old===undefined)delete process.env.TZ;else process.env.TZ=old;l.restore();}
});
