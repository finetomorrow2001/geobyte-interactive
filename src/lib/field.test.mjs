import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
async function load(name,deps={}) {let code=ts.transpileModule(await fs.readFile(new URL(name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;for(const [k,v]of Object.entries(deps))code=code.replaceAll(`'${k}'`,JSON.stringify(v));return {code,module:await import(url(code))};}
const geo=(await load('./field-geometry.ts')).module;
const refl=await load('./reflectance.ts'),scl=await load('./scl.ts');
const metrics=(await load('./field-metrics.ts',{'./reflectance':url(refl.code),'./scl':url(scl.code)})).module;
const rect=geo.rectangle([-97.8,30.2,-97.79,30.21]);
test('AOI holes and disjoint parcels exclude non-farm locations',()=>{
 const g=geo.parseField(JSON.stringify({...rect,coordinates:[...rect.coordinates,geo.rectangle([-97.798,30.202,-97.792,30.208]).coordinates[0]]}));
 assert.equal(geo.inField([-97.795,30.205],g),false);assert.equal(geo.inField([-97.799,30.201],g),true);
 const multi=geo.parseField(JSON.stringify({type:'MultiPolygon',coordinates:[rect.coordinates,geo.rectangle([-97.78,30.2,-97.77,30.21]).coordinates]}));
 assert.equal(geo.inField([-97.775,30.205],multi),true);assert.equal(geo.inField([-97.785,30.205],multi),false);
 const points=geo.fieldGrid(g,48);assert.ok(points.length);assert.ok(points.every(p=>geo.inField(p,g)));
});
test('reject malformed geometry, oversized extents, crossing rings and touching holes',()=>{
 for(const g of [geo.rectangle([-98,30,-97,31]),{type:'Point',coordinates:[-97,30]},{...rect,coordinates:[[[0,0],[.01,.01],[0,.01],[.01,0],[0,0]]]},{...rect,coordinates:[rect.coordinates[0].slice(0,4)]},{...rect,coordinates:[...rect.coordinates,geo.rectangle([-97.8,30.202,-97.795,30.205]).coordinates[0]]}])assert.throws(()=>geo.parseField(JSON.stringify(g)));
 assert.throws(()=>geo.fieldGrid(geo.rectangle([-97.8,30.2,-97.799999,30.200001]),48));
 assert.deepEqual(geo.fieldGrid(rect,48),geo.fieldGrid(rect,48));
});
test('Texas v2 projection metadata uses 14N, supports 15N / Uonuma, and never defaults to Japan',()=>{
 assert.equal(metrics.utmEpsg({'proj:code':'EPSG:32614'}),32614);assert.equal(metrics.utmEpsg({'proj:epsg':32615}),32615);assert.equal(metrics.utmEpsg({'proj:epsg':32654}),32654);
 assert.equal(metrics.utmEpsg({'proj:code':'EPSG:32614','proj:epsg':32654}),32614);assert.throws(()=>metrics.utmEpsg({}));assert.throws(()=>metrics.utmEpsg({'proj:code':'EPSG:4326'}));
});
test('native DN values are not truncated; offsets, cloud masks, zero denominator and missing data are explicit',()=>{
 const bands=[[2000,2000,2000],[3000,3000,3000],[2000,2000,2000],[6000,6000,6000],[4000,4000,4000],[4,9,255]];
 const r=metrics.fieldValues({'s2:processing_baseline':'04.00'},bands);
 assert.equal(r.valid,1);assert.ok(Math.abs(r.values.ndvi[0]-2/3)<1e-12);assert.equal(r.values.ndvi[1],null);assert.equal(r.values.ndvi[2],null);
 const applied=metrics.fieldValues({'earthsearch:boa_offset_applied':true},bands);assert.equal(applied.values.ndvi[0],.5);
 assert.throws(()=>metrics.fieldValues({},bands));
 const zero=metrics.fieldValues({'earthsearch:boa_offset_applied':true},[[1],[1],[0],[3],[2],[4]]);assert.equal(zero.valid,0);
});
test('paired changes use the same positions, require 30 valid pairs and never substitute zero for clouds',()=>{
 const a={id:'a',total:60,values:{ndvi:Array(60).fill(.8)}},b={id:'b',total:60,values:{ndvi:[...Array(30).fill(.5),...Array(30).fill(null)]}};
 const r=metrics.pairedChange(a,b,'ndvi');assert.equal(r.count,30);assert.equal(r.accepted,true);assert.ok(Math.abs(r.mean+.3)<1e-12);assert.equal(r.deltas[30],null);
 assert.equal(metrics.pairedChange({...a,total:100,values:{ndvi:Array(100).fill(.8)}},{...b,total:100,values:{ndvi:[...Array(20).fill(.5),...Array(80).fill(null)]}},'ndvi').accepted,false);
 assert.equal(metrics.summary([null,null]).median,null);
});

 test('CSV preserves negative numerical measurements while neutralizing spreadsheet formulas in text',async()=>{
 const source=await fs.readFile(new URL('./field-export.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
 const {csvCell}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 assert.equal(csvCell(-.57),'-0.57');assert.equal(Number(csvCell(-.57)),-.57);
 assert.equal(csvCell(null),'""');assert.equal(csvCell(NaN),'');
 assert.equal(csvCell('=HYPERLINK("url")'),'"\'=HYPERLINK(""url"")"');
 assert.ok(csvCell('  =SUM(1,2)').startsWith('"\''));
 assert.equal(csvCell('ordinary "scene"'),'"ordinary ""scene"""');
});

test('old baseline, unharmonized offset and harmonized DN give identical physical indices',()=>{
 const physical=[2000,3000,4000,6000,5000,4];
 const native=physical.map(v=>[v]), shifted=physical.map((v,i)=>[i<5?v+1000:v]);
 const old=metrics.fieldValues({'s2:processing_baseline':'03.00'},native);
 const modern=metrics.fieldValues({'s2:processing_baseline':'04.00','earthsearch:boa_offset_applied':false},shifted);
 const harmonized=metrics.fieldValues({'s2:processing_baseline':'05.00','earthsearch:boa_offset_applied':true},native);
 assert.deepEqual(old,modern);assert.deepEqual(old,harmonized);assert.equal(old.values.ndvi[0],.2);
 assert.equal(old.values.ndmi[0],1/11);assert.equal(old.values.ndwi[0],-1/3);assert.equal(old.values.bsi[0],1/17);
});


test('Austin wildlife vicinity presets have valid shared geometry and explicit historical evidence',async()=>{
 const {fieldSites,wildlifeSites}=(await load('./field-sites.ts')).module;
 assert.equal(new Set(fieldSites.map(s=>s.id)).size,fieldSites.length);
 assert.deepEqual(wildlifeSites.map(s=>s.id),['farmshare','griffith']);
 for(const site of wildlifeSites){
  assert.equal(fieldSites.find(s=>s.id===site.id),site);
  const geometry=geo.parseField(JSON.stringify(geo.rectangle(site.bbox)));
  assert.ok(geo.fieldGrid(geometry,48).length>=30);
  for(const lang of ['ja','en']) assert.ok(site.name[lang]&&site.detail[lang]);
  assert.ok(site.sources.length>=2);
  assert.ok(site.sources.every(s=>new URL(s.url).protocol==='https:'));
 }
 assert.ok(geo.inField([-97.5119701,30.1974546],geo.rectangle(wildlifeSites[0].bbox)));
 assert.ok(geo.inField([-97.255320,30.215390],geo.rectangle(wildlifeSites[1].bbox)));
 assert.match(wildlifeSites[0].detail.en,/2022/);
 assert.match(wildlifeSites[1].detail.en,/2011.*predate Sentinel-2/);
});
