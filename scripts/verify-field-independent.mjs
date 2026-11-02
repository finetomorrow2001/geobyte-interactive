// Independent projection/direct-window check. Supply the published proj4 UMD
// bundle path; no production dependencies or browser state are changed.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fromUrl} from 'geotiff';
const proj4=createRequire(import.meta.url)(process.argv[2]);
const source=JSON.parse(await readFile('docs/FIELD_REMAINING_SMOKE.json','utf8'));
const rows=[];
for(const site of source.sites)for(const scene of site.results){
 const i=scene.values.ndvi.findIndex((v,i)=>v!==null&&i>=Math.floor(scene.total/2));
 if(i<0)throw Error('No valid test location');
 const point=site.points[i],zone=scene.epsg%100,xy=proj4('EPSG:4326',`+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`,point),dn=[];
 for(const band of ['blue','green','red','nir','swir16','scl']){
  const image=await (await fromUrl(scene.assets[band],{allowFullFile:false})).getImage();
  const origin=image.getOrigin(),resolution=image.getResolution(),x=Math.floor((xy[0]-origin[0])/resolution[0]),y=Math.floor((xy[1]-origin[1])/resolution[1]);
  const value=await image.readRasters({window:[x,y,x+1,y+1],interleave:false});dn.push(Number(value[0][0]));
 }
 const baseline=Number(scene.properties['s2:processing_baseline']),applied=scene.properties['earthsearch:boa_offset_applied'];
 if(applied!==true&&!Number.isFinite(baseline))throw Error('Unknown baseline');
 const offset=applied===true||baseline<4?0:1000;
 const [b,g,r,n,s]=dn.slice(0,5).map(v=>v-offset),nd=(a,b)=>(a-b)/(a+b);
 if(![2,4,5,6,7].includes(dn[5])||dn.slice(0,5).some(v=>v<=0))throw Error('Invalid reference sample');
 const expected={ndvi:nd(n,r),ndmi:nd(n,s),ndwi:nd(g,n),bsi:nd(s+r,n+b)},actual=Object.fromEntries(Object.keys(expected).map(k=>[k,scene.values[k][i]]));
 const error=Math.max(...Object.keys(expected).map(k=>Math.abs(expected[k]-actual[k])));
 if(error>1e-10)throw Error(`Direct sample mismatch ${scene.id}: ${error}`);
 rows.push({scene:scene.id,epsg:scene.epsg,baseline,applied,point,xy,rawDn:dn,offset,expected,actual,maxIndexError:error});
 console.log(scene.id,'PASS',error);
}
await writeFile('docs/FIELD_INDEPENDENT_CHECK.json',JSON.stringify({testedAt:new Date().toISOString(),method:'proj4 2.22.0 WGS84 UTM; direct geotiff.js window reads (not app sampling/cache); independent index arithmetic',rows},null,2)+'\n');
