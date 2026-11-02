<script lang="ts">
 import { onMount, onDestroy, untrack } from 'svelte';
 import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
 import 'maplibre-gl/dist/maplibre-gl.css';
 import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
 import { makeT,L } from '$lib/i18n/lang.svelte';
 import { fieldDict } from '$lib/i18n/field';
 import { fieldSites } from '$lib/field-sites';
 import { boundsOf,parseField,rectangle,fieldGrid,spacingMeters,type FieldGeometry,type FieldPoint } from '$lib/field-geometry';
 import { csvCell } from '$lib/field-export';
 import { FIELD_INDICES,summary,pairedChange,type FieldIndex,type FieldResult } from '$lib/field-metrics';
 import { fetchScenePage,sceneRequest,todayUtc,type SceneRequest } from '$lib/archive';
 import { installCogProtocol,registerCogLayer,unregisterCogLayer,type TileProgress } from '$lib/cog-protocol';
 import type { StacItem } from '$lib/imagery';
 const t=makeT(fieldDict);
 let mapEl:HTMLDivElement,map:MLMap|undefined;
 let geometry=$state<FieldGeometry>(rectangle(fieldSites[0].bbox));
 let geoText=$state(JSON.stringify(rectangle(fieldSites[0].bbox),null,2)),studyName=$state('Austin field study');
 let site=$state(fieldSites[0].id),from=$state(new Date(Date.now()-365*86400000).toISOString().slice(0,10)),to=$state(todayUtc()),cloud=$state(80),grid=$state(48);
 let scenes=$state<StacItem[]>([]),chosen=$state<string[]>([]),next=$state<SceneRequest|null>(null),searched=$state(false),searching=$state(false);
 let points=$state<FieldPoint[]>([]),results=$state<FieldResult[]>([]),sceneErrors=$state<Record<string,string>>({}),busy=$state(false),progress=$state(''),error=$state('');
 let chartWidth=$state(800),canceled=$state(false);
 let a=$state(''),b=$state(''),metric=$state<FieldIndex>('ndvi'),display=$state('difference'),notes=$state('');
 let drawing=$state(false),first:FieldPoint|null=null,showRaster=$state(false),tile=$state<TileProgress>({pending:0,completed:0,empty:0,failed:0});
 let rejectJob:((e:Error)=>void)|undefined,jobTimer:ReturnType<typeof setTimeout>|undefined;
 let controller:AbortController|undefined,worker:Worker|undefined,version=0,key:string|undefined,disposed=false;
 const resultA=$derived(results.find(r=>r.id===a)),resultB=$derived(results.find(r=>r.id===b));
 const pair=$derived(resultA&&resultB&&a!==b?pairedChange(resultA,resultB,metric):null);
 const sameTime=$derived(resultA&&resultB&&a!==b&&Date.parse(resultA.datetime)===Date.parse(resultB.datetime));
 const acquisitionCounts=$derived.by(()=>{const counts=new Map<number,number>();for(const s of scenes){const time=Date.parse(s.properties.datetime);if(Number.isFinite(time))counts.set(time,(counts.get(time)??0)+1);}return counts;});
 const seasonal=$derived(resultA&&resultB&&Math.abs(Date.parse(resultA.datetime)-Date.parse(resultB.datetime))>45*86400000);
 const sourceSite=$derived(fieldSites.find(s=>s.id===site));
 const text=(v:number|null|undefined)=>v===null||v===undefined?'—':v.toFixed(3);
 function cancel(){version++;controller?.abort();clearTimeout(jobTimer);rejectJob?.(Error('Canceled'));rejectJob=undefined;worker?.terminate();worker=undefined;busy=false;searching=false;}
 function clearResults(){cancel();canceled=false;results=[];sceneErrors={};points=[];a='';b='';error='';showRaster=false;}
 function resetSearch(){clearResults();scenes=[];chosen=[];next=null;searched=false;}
 function applyBoundary(g?:FieldGeometry){
  try{const parsed=parseField(g?JSON.stringify(g):geoText);fieldGrid(parsed,grid);resetSearch();geometry=parsed;geoText=JSON.stringify(parsed,null,2);redraw();const box=boundsOf(parsed);map?.fitBounds([[box[0],box[1]],[box[2],box[3]]],{padding:35,duration:0});}
  catch(e){error=t(e instanceof Error&&e.message==='extent'?'extent':e instanceof Error&&['empty-grid','too-small'].includes(e.message)?'tooSmall':'geometry');}
 }
 function preset(id:string){site=id;const s=fieldSites.find(s=>s.id===id);if(s)applyBoundary(rectangle(s.bbox));}
 async function fileChange(event:Event){const f=(event.target as HTMLInputElement).files?.[0];if(!f)return;if(f.size>150000){error=t('geometry');return;}geoText=await f.text();site='';applyBoundary();}
 async function search(append=false){
  if(busy)return;
  controller?.abort();controller=new AbortController();const current=++version;
  try{
   error='';canceled=false;searching=true;
   const request=append?next:sceneRequest(boundsOf(geometry),from,to,cloud,true);if(!request)return;
   if(!append){results=[];scenes=[];chosen=[];points=[];a='';b='';showRaster=false;sceneErrors={};}
   const page=await fetchScenePage(request,controller.signal);if(current!==version)return;
   const unique=new Map([...scenes,...page.items].map(i=>[i.id,i]));scenes=[...unique.values()].sort((x,y)=>Date.parse(x.properties.datetime)-Date.parse(y.properties.datetime));next=page.next;searched=true;
  }catch(e){if(current===version)error=e instanceof Error?e.message:String(e);}
  finally{if(current===version)searching=false;}
 }
 function choose(id:string,checked:boolean){if(checked&&chosen.length>=12){error=t('choose');return;}chosen=checked?[...chosen,id]:chosen.filter(v=>v!==id);}
 async function analyze(){
  if(chosen.length<2||chosen.length>12){error=t('choose');return;}
  clearResults();const current=version;const selected=scenes.filter(s=>chosen.includes(s.id));
  try{
   points=fieldGrid(geometry,grid);busy=true;
   worker=new Worker(new URL('../../lib/field.worker.ts',import.meta.url),{type:'module'});
   const active=worker;
   for(let i=0;i<selected.length;i++){
    if(version!==current)return;
    const item=selected[i];progress=`${i+1} / ${selected.length} · ${item.id}`;
    const response=await new Promise<{result?:FieldResult;error?:string}>((resolve,reject)=>{
     rejectJob=reject;const timer=setTimeout(()=>reject(Error('Scene analysis timed out (180s)')),180000);jobTimer=timer;
     active.onmessage=e=>{clearTimeout(timer);resolve(e.data);};active.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};
     active.postMessage({item:$state.snapshot(item),points:$state.snapshot(points)});
    });
    if(version!==current)return;
    if(response.result)results=[...results,response.result];else sceneErrors={...sceneErrors,[item.id]:response.error??'Unknown'};
   }
   a=results[0]?.id??'';b=results.at(-1)?.id??'';
  }catch(e){if(current===version)error=e instanceof Error?e.message:String(e);}
  finally{if(current===version){worker?.terminate();worker=undefined;busy=false;progress='';}}
 }
 function redraw(){
  if(!map?.isStyleLoaded())return;
  (map.getSource('aoi') as GeoJSONSource)?.setData({type:'Feature',properties:{},geometry:$state.snapshot(geometry)});
  const vals=display==='difference'?(pair?.accepted?pair.deltas:[]):resultB?.values[metric]??[];
  const scale=display==='difference'?.1:1;
  map.setPaintProperty('samples','circle-color',['interpolate',['linear'],['get','value'],-scale,'#e59b42',0,'#efefdf',scale,'#438de5']);
  const features=points.flatMap((p,i)=>vals[i]!==null&&vals[i]!==undefined?[{type:'Feature' as const,geometry:{type:'Point' as const,coordinates:p},properties:{value:vals[i],sample:i}}]:[]);
  (map.getSource('samples') as GeoJSONSource)?.setData({type:'FeatureCollection',features});
  if(map.getLayer('image'))map.removeLayer('image');if(map.getSource('image'))map.removeSource('image');if(key)unregisterCogLayer(key);key=undefined;
  const item=scenes.find(s=>s.id===b);
  if(showRaster&&item){tile={pending:0,completed:0,empty:0,failed:0};const entry=registerCogLayer(item,{kind:'composite',id:'tci'},1,p=>tile=p);key=entry.key;
   map.addSource('image',{type:'raster',tiles:[entry.tiles],tileSize:256,minzoom:8,maxzoom:15,bounds:item.bbox,attribution:'Sentinel-2 L2A © ESA / Earth Search'});
   map.addLayer({id:'image',type:'raster',source:'image',paint:{'raster-fade-duration':0}},'aoi-fill');
  }
 }
 // State reads are explicit; imperative map operations cannot add effect dependencies.
 $effect(()=>{void geometry;void points;void resultB;void pair;void metric;void display;void showRaster;void b;untrack(redraw);});
 onMount(async()=>{
  const ml=await import('maplibre-gl');if(disposed)return;ml.setWorkerUrl(workerUrl);installCogProtocol(ml);
  map=new ml.Map({container:mapEl,center:[-97.78,30.285],zoom:13,style:{version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm'}]}});
  map.addControl(new ml.NavigationControl());
  map.on('load',()=>{if(!map)return;map.addSource('aoi',{type:'geojson',data:{type:'FeatureCollection',features:[]}});map.addLayer({id:'aoi-fill',type:'fill',source:'aoi',paint:{'fill-color':'#55e7b5','fill-opacity':.08}});map.addLayer({id:'aoi-line',type:'line',source:'aoi',paint:{'line-color':'#55e7b5','line-width':3}});
   map.addSource('samples',{type:'geojson',data:{type:'FeatureCollection',features:[]}});map.addLayer({id:'samples',type:'circle',source:'samples',paint:{'circle-radius':4,'circle-opacity':.7,'circle-color':['interpolate',['linear'],['get','value'],-.5,'#e59b42',0,'#efefdf',.5,'#438de5']}});redraw();});
  map.on('click',e=>{if(!drawing)return;const p:FieldPoint=[e.lngLat.lng,e.lngLat.lat];if(!first){first=p;return;}const q=first;first=null;drawing=false;site='';applyBoundary(rectangle([Math.min(q[0],p[0]),Math.min(q[1],p[1]),Math.max(q[0],p[0]),Math.max(q[1],p[1]) ]));});
 });
 onDestroy(()=>{disposed=true;cancel();if(key)unregisterCogLayer(key);map?.remove();});
 function save(kind:'json'|'csv'){
  const data=kind==='json'?JSON.stringify({schema:'field-study/v1',exportedAt:new Date().toISOString(),name:studyName,geometry:$state.snapshot(geometry),notes,query:{from,to,wholeSceneCloudLimit:cloud,morePages:!!next},method:{gridMax:grid,spacing:spacingMeters(geometry,grid),minimumSpacingMeters:20,indices:FIELD_INDICES,sampling:'fixed lon/lat grid; native nearest values; not independent pixels',sclExcluded:[0,1,3,8,9,10,11],pairMinimum:30,pairShare:.5,interpretation:'screening only, no animal detection or causal attribution'},points:$state.snapshot(points),scenes:scenes.filter(s=>results.some(r=>r.id===s.id)).map(s=>({id:s.id,datetime:s.properties.datetime,properties:s.properties,assets:s.assets})),results:$state.snapshot(results),errors:$state.snapshot(sceneErrors),comparison:{a,b,metric,paired:pair}},null,2):[['scene','datetime','index','valid','total','valid_share','quality_accepted','median','mean','q1','q3'],...results.flatMap(r=>FIELD_INDICES.map(k=>{const s=summary(r.values[k]),share=r.total?r.valid/r.total:0,ok=share>=.5;return [r.id,r.datetime,k,r.valid,r.total,share,ok,ok?s.median:null,ok?s.mean:null,ok?s.q1:null,ok?s.q3:null];}))].map(row=>row.map(csvCell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([data],{type:kind==='json'?'application/json':'text/csv;charset=utf-8'}));const el=document.createElement('a');el.href=url;el.download=`field-study.${kind}`;el.click();URL.revokeObjectURL(url);
 }
 const viewer=$derived(`/imagery?item=${encodeURIComponent(a)}&compare=${encodeURIComponent(b)}&bbox=${boundsOf(geometry).join(',')}`);
 const chartRows=$derived(results.map(r=>({result:r,stats:summary(r.values[metric]),valid:r.valid/r.total>=.5})));
 const chartValues=$derived(chartRows.flatMap(r=>r.valid&&r.stats.q1!==null&&r.stats.q3!==null?[r.stats.q1,r.stats.q3]:[]));
 const dataMin=$derived(chartValues.length?Math.min(...chartValues):-1),dataMax=$derived(chartValues.length?Math.max(...chartValues):1);
 const chartPad=$derived(Math.max(.025,(dataMax-dataMin)*.15));
 const chartMin=$derived(dataMin-chartPad),chartMax=$derived(dataMax+chartPad);
 const firstTime=$derived(results.length?Date.parse(results[0].datetime):0);
 const lastTime=$derived(results.length?Date.parse(results.at(-1)!.datetime):1);
 const chartX=(date:string)=>75+(Date.parse(date)-firstTime)/Math.max(1,lastTime-firstTime)*Math.max(120,chartWidth-130);
 const chartY=(value:number)=>225-(value-chartMin)/(chartMax-chartMin)*200;
</script>

<svelte:head><title>{t('title')} · Satellite Data Lab</title></svelte:head>
<h1>{t('title')}</h1><p>{t('intro')}</p><p class="notice">{t('limit')}</p><p class="muted">{t('edge')}</p>
<details><summary>{t('steps')}</summary><p>{t('method')}</p><p>{t('privacy')}</p><p>{t('pairedRule')}</p></details>
<section class="panel"><h2>{t('aoi')}</h2>
 <label>{t('name')}<input bind:value={studyName} maxlength="120" /></label>
 <label>{t('presets')}<select bind:value={site} onchange={()=>preset(site)}><option value="">GeoJSON</option>{#each fieldSites as s}<option value={s.id}>{L(s.name)}</option>{/each}</select></label>
 <p class="muted">{t('approx')}</p>{#if sourceSite}<a href={sourceSite.source} target="_blank" rel="noreferrer">{t('sources')}</a>{/if}
 <label for="field-geojson">{t('geo')}</label><textarea id="field-geojson" bind:value={geoText} rows="5" spellcheck="false"></textarea>
 <div class="actions"><button onclick={()=>{site='';applyBoundary();}}>{t('apply')}</button><label>{t('file')}<input type="file" accept=".geojson,.json,application/geo+json,application/json" onchange={fileChange} /></label><button class="ghost" onclick={()=>{drawing=!drawing;first=null;}}>{drawing?t('drawing'):t('draw')}</button></div>
 <p class="muted">{t('privacy')}</p>
</section>
<div class="field-map" bind:this={mapEl} role="region" aria-label={t('map')}></div>
<p class="muted">{display==='difference'?t('legend'):t(metric)} · {t('method')} · {t('spacing')}: {spacingMeters(geometry,grid).x.toFixed(1)} × {spacingMeters(geometry,grid).y.toFixed(1)} m</p>
{#if canceled}<p role="status" class="muted">{t('canceled')}</p>{/if}
{#if error}<p role="alert" class="notice">{t('error')}: {error}</p>{/if}
<section class="panel"><h2>{t('search')}</h2><p class="muted">{t('clear')}</p>
 <div class="actions"><label>{t('from')}<input type="date" bind:value={from} min="2015-06-27" max={to} onchange={resetSearch} /></label><label>{t('to')}<input type="date" bind:value={to} min={from} max={todayUtc()} onchange={resetSearch} /></label><label>{t('cloud')}<input type="number" bind:value={cloud} min="0" max="100" onchange={resetSearch} /></label><button onclick={()=>search()} disabled={busy||searching}>{searching?t('searching'):t('search')}</button></div>
 {#if searched&&!scenes.length}<p>{t('empty')}</p>{/if}
 {#if scenes.length}<p>{t('choose')} ({chosen.length}/12; {scenes.length})</p><div class="scene-list">{#each scenes as s (s.id)}<label class="scene"><input type="checkbox" checked={chosen.includes(s.id)} onchange={e=>choose(s.id,e.currentTarget.checked)} disabled={busy} /><span>{s.properties.datetime.slice(0,10)} · ☁ {s.properties['eo:cloud_cover']?.toFixed(1)??'—'}%<small>{s.id}{#if (acquisitionCounts.get(Date.parse(s.properties.datetime))??0)>1} · {t('duplicateTime')}{/if}</small></span></label>{/each}</div>{/if}
 {#if next}<p>{t('moreHint')}</p><button class="ghost" onclick={()=>search(true)} disabled={searching||busy}>{t('more')}</button>{/if}
 <div class="actions"><label>{t('grid')}<select bind:value={grid} onchange={clearResults}>{#each [24,48,96] as n}<option value={n}>{n} × {n}</option>{/each}</select></label><button onclick={analyze} disabled={busy||searching||chosen.length<2||chosen.length>12}>{t('analyze')}</button>{#if busy||searching}<button class="ghost" onclick={()=>{cancel();error='';canceled=true;}}>{t('stop')}</button>{/if}</div>
 {#if busy}<p role="status">{t('working')} {progress}</p>{/if}<p class="muted">{t('unknown')}</p>
 {#each Object.entries(sceneErrors) as [id,message]}<p role="alert">{id}: {message}</p>{/each}
</section>
{#if results.length}
 <section class="panel"><h2>{t('chart')}</h2><label>{t('metric')}<select bind:value={metric}>{#each FIELD_INDICES as k}<option value={k}>{t(k)}</option>{/each}</select></label><p>{t('chartNote')}</p>
 <div bind:clientWidth={chartWidth}><svg viewBox={`0 0 ${chartWidth} 270`} role="img" aria-label={t('chart')}>
  {#each [chartMin,(chartMin+chartMax)/2,chartMax] as v}<line x1="55" y1={chartY(v)} x2={chartWidth-25} y2={chartY(v)} stroke="#526276" stroke-width=".5"/><text x="6" y={chartY(v)+5} fill="currentColor" font-size="12">{v.toFixed(3)}</text>{/each}
  {#each chartRows as row,i}<g><title>{row.result.datetime}: {text(row.stats.median)} · {row.result.valid}/{row.result.total}</title>{#if row.valid&&row.stats.median!==null}{#if row.stats.q1!==null&&row.stats.q3!==null}<line x1={chartX(row.result.datetime)} x2={chartX(row.result.datetime)} y1={chartY(row.stats.q1)} y2={chartY(row.stats.q3)} stroke="#8da8be" stroke-width="3" />{/if}<circle cx={chartX(row.result.datetime)} cy={chartY(row.stats.median)} r="5" fill="#55e7b5" />{:else}<text x={chartX(row.result.datetime)} y="125" fill="currentColor">×</text>{/if}{#if i===0||i===chartRows.length-1||i%Math.max(1,Math.ceil(chartRows.length/Math.max(2,chartWidth/100)))===0}<text transform={`translate(${chartX(row.result.datetime)},245) rotate(-30)`} font-size="11" fill="currentColor">{row.result.datetime.slice(0,10)}</text>{/if}</g>{/each}
 </svg></div>
 <div class="table-scroll"><table><thead><tr><th>{t('date')}</th><th>{t('valid')}</th><th>{t('median')}</th><th>{t('mean')}</th><th>{t('spread')}</th><th>{t('dark')}</th></tr></thead><tbody>{#each results as r}<tr><td title={r.id}>{r.datetime}<small>{r.id}</small></td><td>{r.valid}/{r.total} ({(r.valid/r.total*100).toFixed(1)}%)</td><td>{r.valid/r.total>=.5?text(summary(r.values[metric]).median):t('noData')}</td><td>{r.valid/r.total>=.5?text(summary(r.values[metric]).mean):'—'}</td><td>{r.valid/r.total>=.5?`${text(summary(r.values[metric]).q1)} … ${text(summary(r.values[metric]).q3)}`:'—'}</td><td>{r.dark}</td></tr>{/each}</tbody></table></div>
 </section>
 <section class="panel"><h2>{t('difference')}</h2><div class="actions"><label>{t('baseline')}<select bind:value={a}>{#each results as r}<option value={r.id}>{r.datetime.slice(0,10)} · {r.id}</option>{/each}</select></label><label>{t('comparison')}<select bind:value={b}>{#each results as r}<option value={r.id}>{r.datetime.slice(0,10)} · {r.id}</option>{/each}</select></label><label>{t('display')}<select bind:value={display}><option value="difference">{t('difference')}</option><option value="single">{t('single')}</option></select></label></div>
 <p>{t('pairedRule')}</p>{#if pair}<p>{t('paired')}: {pair.count}/{resultA?.total} ({(pair.share*100).toFixed(1)}%) · {t('median')}: {pair.accepted?text(pair.median):t('noData')} · {t('mean')}: {pair.accepted?text(pair.mean):'—'} · {t('spread')}: {pair.accepted?`${text(pair.q1)} … ${text(pair.q3)}`:'—'}</p>{/if}{#if sameTime}<p class="notice">{t('sameTime')}</p>{/if}{#if seasonal}<p class="notice">{t('season')}</p>{/if}
 <div class="actions"><button class="ghost" onclick={()=>showRaster=!showRaster}>{showRaster?t('rasterOff'):t('raster')}</button><a href={viewer} target="_blank" rel="noreferrer">{t('view')}</a></div>
 {#if showRaster}<p role="status">{tile.failed?t('failed'):tile.pending?t('pending'):tile.completed?t('done'):t('pending')} · {tile.completed} / {tile.pending} · {tile.empty}</p>{/if}
 <label>{t('notes')}<textarea bind:value={notes} rows="3" maxlength="5000" placeholder={t('notesHint')}></textarea></label><div class="actions"><button onclick={()=>save('json')}>{t('json')}</button><button class="ghost" onclick={()=>save('csv')}>{t('csv')}</button></div>
 </section>
{/if}
<details><summary>{t('sources')}</summary><ul><li><a href="https://fieldstations.utexas.edu/field-stations">UT Austin Field Stations</a></li><li><a href="https://integrativebio.utexas.edu/directory/phuong-dao">Phuong Dao · UT Austin</a></li><li><a href="https://lair.etamu.edu/etd/1093/">Wild-pig damage: UAV and ground-truth research (2023)</a></li><li><a href="https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2">Copernicus Sentinel-2</a></li></ul></details>
<style>
 .panel{margin:1rem 0}.notice{border-left:4px solid #e59b42;padding:.8rem;background:#e59b4211}.actions{display:flex;flex-wrap:wrap;gap:.7rem;align-items:end;margin:.7rem 0}label{display:flex;flex-direction:column;gap:.3rem;margin:.4rem 0}input,select,textarea{max-width:100%;min-width:0}textarea{width:100%;font-family:monospace}.field-map{height:460px;border:1px solid #354661;border-radius:12px;overflow:hidden}.scene-list{max-height:280px;overflow:auto}.scene{flex-direction:row;align-items:start;gap:.7rem}.scene input{width:auto}.scene small{display:block;color:var(--muted);overflow-wrap:anywhere}svg{display:block;width:100%;min-height:180px}.table-scroll{overflow:auto;max-width:100%}td small{display:block;color:var(--muted)}th,td{padding:.5rem;text-align:left;white-space:nowrap}h2{font-size:1.2rem} .actions label{max-width:100%}
</style>
