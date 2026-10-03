import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAnnual,searchAnnual,coversBox,manualSelect,reselectByRegion,inFootprint} from './annual.ts';
import {summarizeScl,invalidShare,sclReason,isSclInvalid} from './scl.ts';
import {dnOffsetFor,normDiffDn} from './reflectance.ts';
const options={monthDay:'10-02',years:2,maxCloud:30,tolerance:14,allowMissing:false,now:new Date('2026-10-03T00:00:00Z')};
const item=(date,cloud,id=date)=>({id,properties:{datetime:date+'T01:00:00Z','eo:cloud_cover':cloud},geometry:{type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]]]},bbox:[0,0,10,10],assets:{}});
test('exact day wins even when nearby is clearer',()=>assert.equal(chooseAnnual([item('2025-10-02',25),item('2025-10-01',0)],2025,options).reason,'exact'));
test('cloud fallback picks nearest date before cloud amount',()=>{const r=chooseAnnual([item('2025-10-02',90),item('2025-10-03',20),item('2025-10-05',0)],2025,options);assert.equal(r.offset,1);assert.equal(r.reason,'cloud-adjusted');});
test('absent date stays missing unless explicitly enabled',()=>{const rows=[item('2025-10-01',0)];assert.equal(chooseAnnual(rows,2025,options).item,null);assert.equal(chooseAnnual(rows,2025,{...options,allowMissing:true}).reason,'no-acquisition-adjusted');});
test('unknown cloud is not clear or proof of cloud',()=>assert.equal(chooseAnnual([item('2025-10-02',undefined),item('2025-10-01',0)],2025,options).reason,'quality-unknown'));
test('exclude outside window and future',()=>assert.equal(chooseAnnual([item('2026-10-04',0),item('2026-09-01',0)],2026,{...options,allowMissing:true}).item,null));
test('invalid leap date explicitly missing',()=>assert.equal(chooseAnnual([],2025,{...options,monthDay:'02-29'}).reason,'invalid-date'));
test('same-day only does not change date',()=>assert.equal(chooseAnnual([item('2025-10-02',99),item('2025-10-01',0)],2025,{...options,tolerance:0}).item,null));
test('entire box must lie inside footprint',()=>{assert.equal(coversBox(item('2025-10-02',0),[1,1,9,9]),true);assert.equal(coversBox(item('2025-10-02',0),[9,9,11,11]),false);});
test('pagination is followed and result sorted chronologically',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify(calls===1?{features:[],links:[{rel:'next',href:'https://earth-search.aws.element84.com/v1/search?page=2'}]}:{features:[item('2025-10-02',10)],links:[]}),{status:200});};
 try {const rows=await searchAnnual([1,1,2,2],{...options,years:1,now:new Date('2025-10-03T00:00:00Z')});assert.equal(calls,2);assert.equal(rows[0].reason,'exact');}finally{globalThis.fetch=original;}
});

test('manual alternatives obey the missing-acquisition preference',()=>{
 const rows=[item('2025-10-01',0)];
 assert.deepEqual(chooseAnnual(rows,2025,options).alternatives,[]);
 assert.equal(chooseAnnual(rows,2025,{...options,allowMissing:true}).alternatives.length,1);
});
test('invalid cloud values cannot be accepted',()=>{
 for(const value of [-1,101,NaN]) assert.equal(chooseAnnual([item('2025-10-02',value)],2025,options).reason,'quality-unknown');
});
test('invalid thresholds rejected before search',async()=>{
 await assert.rejects(searchAnnual([1,1,2,2],{...options,maxCloud:NaN}),/Invalid search options/);
});

test('manual selection: same-day candidate restores the exact reason, others are manual',()=>{
 const rows=[item('2025-10-02',25),item('2025-10-01',0)];
 const row=chooseAnnual(rows,2025,options);
 const other=manualSelect(row,rows[1]);
 assert.equal(other.reason,'manual-quality-adjusted');assert.equal(other.offset,-1);
 const back=manualSelect(other,rows[0]);
 assert.equal(back.reason,'exact');assert.equal(back.offset,0);
});

const sum=(invalid)=>({total:100,valid:100-invalid,outside:0,nodata:0,saturated:0,shadow:0,cloud:invalid,cirrus:0,snow:0,dark:0,unclassified:0});
test('region reselect: keeps a clear scene, replaces a cloudy one with the nearest clear candidate and records why',()=>{
 const a=item('2025-10-02',5,'a'),b=item('2025-10-04',5,'b'),c=item('2025-10-06',5,'c');
 const row={...chooseAnnual([a,b,c],2025,options),alternatives:[a,b,c]};
 assert.equal(row.item.id,'a');
 const keep=reselectByRegion(row,{a:sum(10)},0.2);assert.equal(keep.item.id,'a');assert.equal(keep.reason,'exact');
 const r=reselectByRegion(row,{a:sum(40),b:sum(50),c:sum(5)},0.2);
 assert.equal(r.item.id,'c');assert.equal(r.reason,'region-adjusted');assert.equal(r.offset,4);
 assert.deepEqual(r.adjustedFrom,{date:'2025-10-02',invalid:0.4});
 const none=reselectByRegion(row,{a:sum(40),b:sum(50),c:sum(60)},0.2);
 assert.equal(none.item.id,'a');assert.equal(none.regionNote,'no-clear-alternative');
 assert.equal(reselectByRegion(row,{},0.2).item.id,'a');
});
test('manual selection clears the region adjustment record',()=>{
 const a=item('2025-10-02',5,'a'),b=item('2025-10-04',5,'b');
 const adj={...chooseAnnual([a,b],2025,options),adjustedFrom:{date:'x',invalid:0.5},reason:'region-adjusted'};
 assert.equal(manualSelect(adj,a).adjustedFrom,undefined);
});
test('inFootprint',()=>{assert.equal(inFootprint(item('2025-10-02',0),5,5),true);assert.equal(inFootprint(item('2025-10-02',0),11,5),false);});
test('SCL: invalid classes, reasons and summary denominator',()=>{
 for(const v of [0,1,3,8,9,10,11,255,null])assert.equal(isSclInvalid(v),true,String(v));
 for(const v of [2,4,5,6,7])assert.equal(isSclInvalid(v),false,String(v));
 assert.equal(sclReason(8),'cloud');assert.equal(sclReason(3),'shadow');assert.equal(sclReason(10),'cirrus');assert.equal(sclReason(11),'snow');assert.equal(sclReason(0),'nodata');assert.equal(sclReason(null),'nodata');assert.equal(sclReason(4),null);
 const s=summarizeScl(Uint8Array.from([4,4,5,2,7,8,9,3,10,11,0,1,255,6]));
 assert.deepEqual([s.total,s.valid,s.cloud,s.shadow,s.cirrus,s.snow,s.nodata,s.saturated,s.outside,s.dark,s.unclassified],[14,6,2,1,1,1,1,1,1,1,1]);
 assert.equal(invalidShare(s),8/14);
});
test('reflectance offset follows Earth Search metadata and is never applied twice',()=>{
 assert.equal(dnOffsetFor({'earthsearch:boa_offset_applied':true,'s2:processing_baseline':'05.11'}).offset,0);
 assert.equal(dnOffsetFor({'earthsearch:boa_offset_applied':false,'s2:processing_baseline':'02.14'}).offset,0);
 assert.equal(dnOffsetFor({'earthsearch:boa_offset_applied':false,'s2:processing_baseline':'04.00'}).offset,1000);
 assert.equal(dnOffsetFor({}).offset,0);
 assert.equal(dnOffsetFor({}).known,false);assert.equal(dnOffsetFor({'s2:processing_baseline':'garbage'}).known,false);
 for(const p of [{'earthsearch:boa_offset_applied':true},{'earthsearch:boa_offset_applied':false,'s2:processing_baseline':'02.14'},{'earthsearch:boa_offset_applied':false,'s2:processing_baseline':'04.00'}])assert.equal(dnOffsetFor(p).known,true);
 // NDVI: offset-applied DN (already reflectance*1e4) vs raw DN with +1000 give the same index once the offset is removed
 const applied=normDiffDn(3000,500,0),raw=normDiffDn(4000,1500,1000);
 assert.ok(Math.abs(applied-raw)<1e-12);
 assert.equal(normDiffDn(null,1,0),null);assert.equal(normDiffDn(0,0,0),null);
});
