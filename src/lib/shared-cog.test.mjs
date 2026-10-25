import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { BaseClient, BaseResponse } from 'geotiff';
const load = async (path, replace = s => s) => {
 const code = ts.transpileModule(replace(await readFile(new URL(path, import.meta.url),'utf8')), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
};
const {serveCogRange,MAX_RANGE_BYTES}=await load('./server/cog-range.ts');
const path='54/T/WN/2026/10/S2B_54TWN_20261023_1_L2A/B04.tif';
const origin='https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/';
test('shared cache preserves exact bytes and uses cacheable range-specific response',async()=>{
 const bytes=new Uint8Array([0,255,17,128]);
 const r=await serveCogRange('12-15/'+path,async(url,init)=>{
  assert.equal(url,origin+path);assert.equal(init.headers.Range,'bytes=12-15');assert.equal(init.redirect,'error');
  return new Response(bytes,{status:206,headers:{'Content-Range':'bytes 12-15/100'}});
 });
 assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
 assert.equal(r.headers.get('x-cog-range'),'bytes 12-15/100');assert.match(r.headers.get('vercel-cdn-cache-control'),/max-age=604800/);
});
test('invalid or oversized requests never fetch; errors cannot be cached',async()=>{
 for(const key of ['0-1/https://evil.test/a.tif','0-1/../'+path,'1-0/'+path,`0-${MAX_RANGE_BYTES}/`+path,'00-1/'+path]){
  const r=await serveCogRange(key,()=>{throw Error('must not fetch')});assert.equal(r.status,400);assert.equal(r.headers.get('cache-control'),'no-store');
 }
 for(const r of [new Response('whole',{status:200}),new Response('x',{status:206,headers:{'content-range':'bytes 1-2/100'}}),new Response('x',{status:206,headers:{'content-range':'bytes 0-1/100'}})]){
  const out=await serveCogRange('0-1/'+path,async()=>r);assert.equal(out.status,502);assert.equal(out.headers.get('cache-control'),'no-store');
 }
});
test('client reassembles oversized ranges byte-for-byte and falls back on invalid cache response',async()=>{
 globalThis.__sharedCogDeps={BaseClient,BaseResponse,Pool:class{},fromCustomClient:()=>{}};
 const {fetchCogRange}=await load('./cog.ts',s=>s.replace(/import[^;]+from 'geotiff';/, 'const { BaseClient, BaseResponse, Pool, fromCustomClient } = globalThis.__sharedCogDeps;'));
 const oldFetch=globalThis.fetch, oldLocation=globalThis.location;
 globalThis.location={origin:'https://app.test'};
 const size=MAX_RANGE_BYTES+19,bytes=Uint8Array.from({length:size},(_,i)=>i%251);let calls=0;
 try{
  globalThis.fetch=async(url)=>{calls++;const m=String(url).match(/v1\/(\d+)-(\d+)\//);assert.ok(m);const a=Number(m[1]),b=Number(m[2]);return new Response(bytes.slice(a,b+1),{headers:{'x-cog-range':`bytes ${a}-${b}/${size}`}})};
  const response=await fetchCogRange(origin+path,{headers:{Range:`bytes=0-${size-1}`}});
  assert.equal(response.status,206);assert.equal(calls,2);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  calls=0;globalThis.fetch=async(url)=>{calls++;return String(url).startsWith(origin)?new Response(new Uint8Array([42]),{status:206}):new Response('bad',{status:502})};
  const fallback=await fetchCogRange(origin+path,{headers:{Range:'bytes=0-0'}});assert.equal(calls,2);assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()),new Uint8Array([42]));
  const controller=new AbortController();controller.abort();calls=0;
  await assert.rejects(fetchCogRange(origin+path,{headers:{Range:'bytes=0-0'},signal:controller.signal}));assert.equal(calls,1);
 }finally{globalThis.fetch=oldFetch;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;delete globalThis.__sharedCogDeps;}
});
