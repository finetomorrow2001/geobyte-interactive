import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAnnual,searchAnnual,coversBox,manualSelect} from './annual.ts';
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
