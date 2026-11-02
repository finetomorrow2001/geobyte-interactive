import { dnOffsetFor } from './reflectance';
import { isSclInvalid } from './scl';
export const FIELD_INDICES = ['ndvi','ndmi','ndwi','bsi'] as const;
export type FieldIndex = typeof FIELD_INDICES[number];
export type FieldValues = Record<FieldIndex,(number|null)[]>;
export type FieldResult = { id: string; datetime: string; epsg: number; offset: number; valid: number; total: number; excluded: number; dark: number; values: FieldValues };
export function utmEpsg(props: Record<string,unknown>): number {
 const code=props['proj:code'] ? String(props['proj:code']).replace(/^EPSG:/,'') : props['proj:epsg'];
 const epsg=Number(code);
 if(!Number.isInteger(epsg)||!((epsg>=32601&&epsg<=32660)||(epsg>=32701&&epsg<=32760)))throw Error('utm');
 return epsg;
}
/** All dates use the same AOI points. No interpolation, DN truncation, or damage inference. */
export function fieldValues(props: Record<string,unknown>,bands: number[][]): {values: FieldValues; valid: number; dark: number} {
 const offset=dnOffsetFor(props);if(!offset.known)throw Error('offset');
 if(bands.length!==6||bands.some(b=>b.length!==bands[0].length))throw Error('bands');
 const values: FieldValues={ndvi:[],ndmi:[],ndwi:[],bsi:[]};let valid=0,dark=0;
 for(let i=0;i<bands[0].length;i++) {
  const [blue,green,red,nir,swir,scl]=bands.map(b=>b[i]);
  const ok=!isSclInvalid(scl)&&[blue,green,red,nir,swir].every(v=>Number.isFinite(v)&&v>0);
  const [b,g,r,n,s]=[blue,green,red,nir,swir].map(v=>v-offset.offset);
  const nd=(a:number,b:number)=>a+b>0?(a-b)/(a+b):null;
  const row=ok?{ndvi:nd(n,r),ndmi:nd(n,s),ndwi:nd(g,n),bsi:nd(s+r,n+b)}:null;
  if(row&&FIELD_INDICES.every(k=>row[k]!==null&&Number.isFinite(row[k]))) {
   valid++;if(scl===2)dark++;for(const k of FIELD_INDICES)values[k].push(row[k]);
  }else for(const k of FIELD_INDICES)values[k].push(null);
 }
 return {values,valid,dark};
}
export function summary(values:(number|null)[]) {
 const xs=values.filter((v):v is number=>v!==null&&Number.isFinite(v)).sort((a,b)=>a-b);
 if(!xs.length)return {count:0,mean:null,median:null,q1:null,q3:null};
 const q=(p:number)=>{const k=(xs.length-1)*p,l=Math.floor(k);return xs[l]+(xs[Math.ceil(k)]-xs[l])*(k-l);};
 return {count:xs.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,median:q(.5),q1:q(.25),q3:q(.75)};
}
export function pairedChange(a: FieldResult,b: FieldResult,index:FieldIndex,minValid=.5) {
 if(a.total!==b.total||a.values[index].length!==b.values[index].length)throw Error('grid');
 const deltas=a.values[index].map((v,i)=>v!==null&&b.values[index][i]!==null?b.values[index][i]!-v:null);
 const stats=summary(deltas),share=a.total?stats.count/a.total:0;
 return {...stats,share,accepted:share>=minValid&&stats.count>=30,deltas};
}
