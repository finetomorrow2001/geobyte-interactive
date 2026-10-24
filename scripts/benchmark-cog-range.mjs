import {fromUrl} from 'geotiff';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const scene='S2B_54TWN_20261023_1_L2A';
const item=await (await fetch(`https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${scene}`)).json();
const href=item.assets.visual.href;
const nativeFetch=globalThis.fetch;
const results=[];
for(const buffered of [false,true,true,false,false,true]) {
 let count=0,bytes=0;
 globalThis.fetch=async(...args)=>{
  count++; const response=await nativeFetch(...args);
  bytes+=Number(response.headers.get('content-length')||0);
  return response;
 };
 const start=performance.now();
 const options=buffered?{allowFullFile:false,blockSize:65536,cacheSize:16}:{allowFullFile:false};
 const tiff=await fromUrl(href,options); const n=await tiff.getImageCount();
 const images=[];for(let i=0;i<n;i++)images.push(await tiff.getImage(i));
 const headerMs=performance.now()-start,headerRequests=count,headerBytes=bytes;
 const image=images[Math.min(3,n-1)];
 const w=image.getTileWidth(),h=image.getTileHeight();
 const pixels=await image.readRasters({window:[0,0,w,h]});
 const firstMs=performance.now()-start;
 const again=await image.readRasters({window:[0,0,w,h]});
 const same=pixels.every((band,b)=>band.every((v,k)=>v===again[b][k]));
 const hash=createHash('sha256');for(const band of pixels)hash.update(new Uint8Array(band.buffer,band.byteOffset,band.byteLength));
 results.push({pixelHash:hash.digest('hex'),buffered,headerMs,headerRequests,headerBytes,totalMs:performance.now()-start,firstMs,requests:count,bytes,identical:same});
 console.log(results.at(-1));
}
globalThis.fetch=nativeFetch;
mkdirSync('docs/testing',{recursive:true});
writeFileSync('docs/testing/cog-range-benchmark.json',JSON.stringify({scene,href,results},null,2));
