// Temporary CDP page-init instrumentation, never shipped in the application.
// Reloading creates fresh workers. cache:no-store bypasses the browser HTTP cache;
// it does not send request Cache-Control/Pragma here (verified via CDP).
(() => {
 window.__qaNetwork=[];window.__qaTiles=[];window.__qaMaps=[];window.__qaResults=[];
 const NativeWorker=window.Worker;
 window.Worker=class extends NativeWorker {
  constructor(url,options){
   const href=new URL(String(url),location.href).href;
   const isCog=/\/cog\.worker-[^/]+\.js$/.test(new URL(href).pathname);
   const wrap=`const queued=[];const gate=e=>{queued.push(e.data);e.stopImmediatePropagation();};self.addEventListener('message',gate,true);const originalFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=async(input,init={})=>{const url=String(input instanceof Request?input.url:input);const start=performance.now();try{const response=await originalFetch(input,{...init,cache:'no-store'});self.postMessage({__qaNetwork:{url,status:response.status,cache:response.headers.get('x-vercel-cache'),range:response.headers.get('x-cog-range'),length:response.headers.get('content-length'),ttfbMs:performance.now()-start}});return response;}catch(error){self.postMessage({__qaNetwork:{url,error:String(error)}});throw error;}};await import(${JSON.stringify(href)});self.removeEventListener('message',gate,true);for(const data of queued)self.dispatchEvent(new MessageEvent('message',{data}));`;
   const blob=isCog?URL.createObjectURL(new Blob([wrap],{type:'text/javascript'})):null;
   super(blob||url,options);
   if(!isCog)return;
   const jobs=new Map();const send=this.postMessage.bind(this);
   this.postMessage=(job,...args)=>{if(job.kind==='tile')jobs.set(job.id,{...job,started:performance.now()});return send(job,...args)};
   this.addEventListener('message',e=>{
    if(e.data?.__qaNetwork){window.__qaNetwork.push(e.data.__qaNetwork);e.stopImmediatePropagation();return;}
    const job=jobs.get(e.data?.id);if(!job)return;jobs.delete(e.data.id);
    const row={...job,ms:performance.now()-job.started,error:e.data.error};
    if(e.data.rgba)crypto.subtle.digest('SHA-256',e.data.rgba).then(b=>{row.sha256=[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('');window.__qaTiles.push(row)});
    else window.__qaTiles.push(row);
   });
  }
 };
 import('/_app/immutable/chunks/Bj1T2umq.js').then(m=>{
  const original=m.Map.prototype.getBearing;
  m.Map.prototype.getBearing=function(...args){if(!window.__qaMaps.includes(this))window.__qaMaps.push(this);return original.apply(this,args)};
  window.__qaRestore=()=>{m.Map.prototype.getBearing=original;window.Worker=NativeWorker};
 });
 window.__qaWait=async(label,start=performance.now())=>{
  const end=start+180000;let stable=0;
  while(performance.now()<end){
   const maps=window.__qaMaps.filter(m=>!m._removed);
   const status=[...document.querySelectorAll('[role=status]')].map(e=>e.textContent).join(' ');
   if(maps.length===2&&maps.every(m=>m.areTilesLoaded()&&!m.isMoving())&&status.includes('A ·')&&status.includes('B ·')&&!status.includes('画像更新中')&&!status.includes('取得失敗')){
    if(!stable)stable=performance.now();
    if(performance.now()-stable>600){const cameras=maps.map(m=>({center:m.getCenter().toArray(),zoom:m.getZoom(),bearing:m.getBearing(),pitch:m.getPitch(),size:[m.getCanvas().width,m.getCanvas().height]}));
     const r={label,ms:stable-start,cameras,status,network:window.__qaNetwork.length,tiles:window.__qaTiles.length};window.__qaResults.push(r);return r;}
   }else stable=0;
   await new Promise(r=>setTimeout(r,100));
  }
  const r={label,error:'180s deadline',status:[...document.querySelectorAll('[role=status]')].map(e=>e.textContent)};window.__qaResults.push(r);return r;
 };
})();
