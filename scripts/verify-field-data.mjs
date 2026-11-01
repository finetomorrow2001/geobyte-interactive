// Real network/data smoke test; not a replacement for independent browser QA.
// Transpile the same TS modules without modifying checked-in production code.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import ts from 'typescript';
const dir=await mkdtemp(resolve('.field-verify-'));
try {
 for(const name of ['cog','field-geometry','field-metrics','reflectance','scl']) {
  let source=await readFile(`src/lib/${name}.ts`,'utf8');
  source=source.replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${p}.mjs'`);
  await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
 }
 const {sampleLocations}=await import(`${dir}/cog.mjs`),{fieldGrid,rectangle}=await import(`${dir}/field-geometry.mjs`),{fieldValues,utmEpsg,summary,pairedChange}=await import(`${dir}/field-metrics.mjs`);
 const sites=[['Austin',[-97.785,30.281,-97.775,30.289]],['Uonuma',[138.95,37.222,138.964,37.234]]];
 const report={testedAt:new Date().toISOString(),method:'Real Earth Search / native COG sampling, same production functions. Not browser QA.',sites:[]};
 for(const [name,bbox] of sites){
  const body={collections:['sentinel-2-l2a'],bbox,datetime:'2025-09-01T00:00:00Z/2025-10-31T23:59:59Z',query:{'eo:cloud_cover':{lt:20}},limit:2,sortby:[{field:'properties.datetime',direction:'desc'}]};
  const response=await fetch('https://earth-search.aws.element84.com/v1/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`STAC HTTP ${response.status}`);
  const catalog=await response.json(),points=fieldGrid(rectangle(bbox),24),results=[];
  if(catalog.features?.length!==2)throw Error(`${name}: two scenes unavailable`);
  for(const item of catalog.features){
   const start=performance.now(),epsg=utmEpsg(item.properties),bands=[];
   for(const band of ['blue','green','red','nir','swir16','scl'])bands.push(await sampleLocations(item.assets[band].href,epsg,points));
   const value=fieldValues(item.properties,bands),result={id:item.id,datetime:item.properties.datetime,total:points.length,...value};results.push(result);
   console.log(JSON.stringify({site:name,scene:result.id,epsg,elapsedMs:Math.round(performance.now()-start),valid:result.valid,total:result.total,ndvi:summary(result.values.ndvi)}));
  }
  report.sites.push({name,bbox,points,results,comparison:pairedChange(results[0],results[1],'ndvi')});
 }
 await writeFile('docs/FIELD_DATA_SMOKE.json',JSON.stringify(report,null,2)+'\n');
} finally {await rm(dir,{recursive:true,force:true});}
