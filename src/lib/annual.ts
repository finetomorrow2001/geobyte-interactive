import type { StacItem } from './imagery';
import { invalidShare, type SclSummary } from './scl.ts';

export type AnnualOptions = { monthDay: string; years: number; maxCloud: number; tolerance: number; allowMissing: boolean; now?: Date };
export type AnnualScene = { year: number; target: string; item: StacItem | null; offset: number | null; reason: string; candidates: number; alternatives?: StacItem[];
 /** 地域内の無効画素率で自動的に差し替えたとき、変更前の撮影日と地域内無効率（0..1） */
 adjustedFrom?: { date: string; invalid: number };
 /** 'no-clear-alternative': 地域内の無効画素率が閾値を超えるが、条件を満たす代替がない */
 regionNote?: 'no-clear-alternative' };
const DAY = 86400000;
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function targetTime(year: number, monthDay: string): number {
 const t = Date.parse(`${year}-${monthDay}T00:00:00Z`);
 if (!Number.isFinite(t) || date(t) !== `${year}-${monthDay}`) throw new Error('Invalid calendar date');
 return t;
}
export function chooseAnnual(items: StacItem[], year: number, options: AnnualOptions): AnnualScene {
 const target = `${year}-${options.monthDay}`;
 let t: number;
 try { t = targetTime(year, options.monthDay); } catch { return {year,target,item:null,offset:null,reason:'invalid-date',candidates:0}; }
 const offset = (i: StacItem) => Math.round((Date.parse(i.properties.datetime.slice(0,10)+'T00:00:00Z')-t)/DAY);
 const cloud = (i: StacItem) => { const v=i.properties['eo:cloud_cover']; return typeof v==='number' && Number.isFinite(v) && v>=0 && v<=100 ? v : Infinity; };
 const eligible = items.filter(i => Math.abs(offset(i))<=options.tolerance && Date.parse(i.properties.datetime)<=(options.now??new Date()).getTime());
 const exact = eligible.filter(i=>offset(i)===0);
 const clear = eligible.filter(i=>cloud(i)<=options.maxCloud).sort((a,b)=>Math.abs(offset(a))-Math.abs(offset(b)) || cloud(a)-cloud(b) || a.id.localeCompare(b.id));
 const sameDay = clear.find(i=>offset(i)===0);
 let selected = sameDay;
 const cloudy = exact.length>0 && exact.every(i=>Number.isFinite(cloud(i)) && cloud(i)>options.maxCloud);
 if (!selected && (cloudy || (!exact.length && options.allowMissing))) selected=clear[0];
 return {year,target,item:selected??null,offset:selected?offset(selected):null,candidates:eligible.length,alternatives:exact.length || options.allowMissing ? clear : [],
 reason:sameDay?'exact':selected?(cloudy?'cloud-adjusted':'no-acquisition-adjusted'):!exact.length?'no-acquisition':cloudy?'cloud-no-alternative':'quality-unknown'};
}
export async function searchAnnual(bbox: [number,number,number,number], options: AnnualOptions): Promise<AnnualScene[]> {
 const now=options.now??new Date();
 if (!Number.isInteger(options.years)||options.years<1||options.years>10||!Number.isInteger(options.tolerance)||options.tolerance<0||options.tolerance>31||!Number.isFinite(options.maxCloud)||options.maxCloud<0||options.maxCloud>100) throw new Error('Invalid search options');
 // Validate month/day using a leap year; each non-leap year may legitimately be missing.
 targetTime(2024, options.monthDay);
 const results: AnnualScene[]=[];
 for(let year=now.getUTCFullYear();year>=2017 && results.length<options.years;year--){
  let t:number;
  try { t=targetTime(year,options.monthDay); } catch {results.push(chooseAnnual([],year,options));continue;}
  if(t>now.getTime())continue;
  const from=t-options.tolerance*DAY, to=Math.min(t+(options.tolerance+1)*DAY-1,now.getTime());
  const features:StacItem[]=[];let url='https://earth-search.aws.element84.com/v1/search';
  let init:RequestInit={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({collections:['sentinel-2-l2a'],bbox,datetime:`${new Date(from).toISOString()}/${new Date(to).toISOString()}`,limit:100})};
  let complete=false;
  for(let page=0;page<20;page++){
   const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new Error(`STAC ${response.status} (${year})`);
   const data=await response.json();features.push(...data.features);
   const next=data.links?.find((l:{rel:string})=>l.rel==='next');
   if(!next){complete=true;break;}
   url=next.href;
   if(new URL(url).origin!=='https://earth-search.aws.element84.com')throw new Error('Unexpected pagination host');
   init=next.method==='POST'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next.merge?{...JSON.parse(String(init.body)),...next.body}:next.body)}:{method:'GET'};
  }
  if(!complete)throw new Error(`Incomplete STAC results (${year})`);
  // Require the footprint, not just its bounding box, to cover the whole display box.
  const covered=features.filter(i=>coversBox(i,bbox));
  results.push(chooseAnnual(covered,year,options));
 }
 return results.reverse();
}
export function inRing(x:number,y:number,ring:number[][]):boolean {
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i], [xj,yj]=ring[j];
  if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
export function coversBox(item:StacItem,b:[number,number,number,number]):boolean {
 if(item.geometry.type!=='Polygon')return false;
 const rings=item.geometry.coordinates;
 return [[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[(b[0]+b[2])/2,(b[1]+b[3])/2]].every(([x,y])=>inRing(x,y,rings[0])&&!rings.slice(1).some(r=>inRing(x,y,r)));
}
/** シーンの輪郭（外周・穴）に点が入るか */
export function inFootprint(item: StacItem, lon: number, lat: number): boolean {
 if(item.geometry.type!=='Polygon')return false;
 const rings=item.geometry.coordinates;
 return inRing(lon,lat,rings[0])&&!rings.slice(1).some(r=>inRing(lon,lat,r));
}
const dayOf=(i: StacItem)=>Date.parse(i.properties.datetime.slice(0,10)+'T00:00:00Z');
/**
 * 地域内の無効画素率（SCL）で採用日を再選定する。採用中のシーンの無効率が maxInvalid（0..1）以下ならそのまま。
 * 超える場合は、集計済みの候補（採用中＋alternatives）のうち閾値以下で基準日に最も近いもの（同距離なら無効率が低いもの）に
 * 差し替え、理由 'region-adjusted' と変更前の撮影日・無効率を残す。条件を満たす候補がなければ変更せず regionNote を付ける。
 * 集計が無いシーンは判断せず（未集計）そのまま。
 */
export function reselectByRegion(row: AnnualScene, stats: Record<string, SclSummary>, maxInvalid: number): AnnualScene {
 const cur=row.item; if(!cur)return row;
 const share=(i: StacItem)=>stats[i.id]?invalidShare(stats[i.id]):undefined;
 const curShare=share(cur);
 if(curShare===undefined||curShare<=maxInvalid)return {...row,regionNote:undefined};
 const t=Date.parse(row.target+'T00:00:00Z');
 const seen=new Set<string>();
 const pool=[cur,...(row.alternatives??[])].filter(i=>!seen.has(i.id)&&!!seen.add(i.id));
 const ok=pool.filter(i=>{const v=share(i);return v!==undefined&&v<=maxInvalid;})
  .sort((a,b)=>Math.abs(dayOf(a)-t)-Math.abs(dayOf(b)-t)||share(a)!-share(b)!||a.id.localeCompare(b.id));
 if(!ok.length)return {...row,regionNote:'no-clear-alternative'};
 const item=ok[0];
 return {...row,item,offset:Math.round((dayOf(item)-t)/DAY),reason:'region-adjusted',regionNote:undefined,adjustedFrom:{date:cur.properties.datetime.slice(0,10),invalid:curShare}};
}

/** 年カードの候補を手動で差し替えた行を返す。同じ月日の画像に戻した場合は理由も「同じ月日 (exact)」に戻す */
export function manualSelect(row: AnnualScene, item: StacItem): AnnualScene {
 const offset=Math.round((Date.parse(item.properties.datetime.slice(0,10)+'T00:00:00Z')-Date.parse(row.target+'T00:00:00Z'))/DAY);
 return {...row,item,offset,reason:offset===0?'exact':'manual-quality-adjusted',adjustedFrom:undefined,regionNote:undefined};
}
