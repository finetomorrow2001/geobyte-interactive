import { sampleLocations } from './cog';
import { fieldValues, utmEpsg } from './field-metrics';
import { dnOffsetFor } from './reflectance';
import type { StacItem } from './imagery';
self.onmessage=async(e: MessageEvent<{item:StacItem;points:[number,number][]}>)=>{
 const {item,points}=e.data;
 try {
  const epsg=utmEpsg(item.properties),offset=dnOffsetFor(item.properties);
  if(!offset.known)throw Error('offset');
  const names=['blue','green','red','nir','swir16','scl'];
  if(names.some(n=>!item.assets[n]?.href))throw Error('bands');
  const bands=[];
  // Sequential bands share the decoded cache without overwhelming the source.
  for(const name of names)bands.push(await sampleLocations(item.assets[name].href,epsg,points));
  const stats=fieldValues(item.properties,bands);
  self.postMessage({result:{id:item.id,datetime:item.properties.datetime,epsg,offset:offset.offset,total:points.length,excluded:points.length-stats.valid,...stats}});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
