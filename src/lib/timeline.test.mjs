import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';

// Exercise production timeline functions with a controllable wall clock, not copied logic.
const page = await fs.readFile(new URL('../routes/imagery/+page.svelte', import.meta.url), 'utf8');
const script = page.split('<script lang="ts">')[1].split('</script>')[0];
const ast = ts.createSourceFile('component.ts', script, ts.ScriptTarget.Latest, true);
const names = ['tick', 'setOffset', 'jumpToTime', 'shiftTime', 'sceneAt', 'selectA', 'selectPass'];
const funcs = ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text));
assert.equal(funcs.length, names.length);
const expressions = ast.statements.filter(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => ['displayTime', 'fmtExactJst', 'fmtOffset'].includes(d.name.getText(ast))));
assert.equal(expressions.length, 3);
function harness() {
 let now = Date.parse('2026-11-06T17:00:32.987Z');
 class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
 const context = vm.createContext({Date: Clock, setTimeout: () => 0, clearTimeout: () => {}});
 const code = `let fixedTimeMs=null,timeOffsetMin=0,timeJumpAt=null,playing=false,shownTime=new Date(),tleSet={tles:[]},satNow={},satMarkers=new Map(),syncScene=true,items=[],itemA=null,selectedPass=null,animationPlaying=false,point=null,switched=null,switchedTimer;
 const forMaps=()=>{},updateTracks=()=>{},refreshLayers=()=>{},refreshPoint=()=>{},fmtDate=x=>x,satLabel=()=> 'S2A';
 ${expressions.map(s=>s.getText(ast)).join('\n')}
 ${funcs.map(s=>s.getText(ast)).join('\n')}
 globalThis.api={tick,setOffset,jumpToTime,shiftTime,sceneAt,selectA,selectPass,format:fmtExactJst,formatOffset:fmtOffset,
 setItems:x=>items=x,setSync:x=>syncScene=x,play:()=>playing=true,noTle:()=>tleSet=null,
 state:()=>({at:shownTime.getTime(),fixedTimeMs,timeOffsetMin,timeJumpAt,playing,item:itemA?.id})};`;
 vm.runInContext(ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText, context);
 return {api:context.api,advance:ms=>now+=ms,now:()=>now};
}
const item=(id,at)=>({id,properties:{datetime:new Date(at).toISOString()}});
const acquisition=Date.parse('2026-10-23T01:46:59.123Z');
test('date selection retains acquisition milliseconds without drift or minute rollover',()=>{
 const h=harness();h.api.setItems([item('A',acquisition)]);h.api.jumpToTime(acquisition);
 assert.equal(h.api.state().at,acquisition);assert.equal(h.api.state().item,'A');
 h.advance(125000);h.api.tick();h.api.tick();assert.equal(h.api.state().at,acquisition);
 assert.equal(h.api.state().timeJumpAt,acquisition);assert.match(h.api.format(new Date(acquisition)),/10:46:59/);
});
test('image synchronization does not select acquisitions even one millisecond in the future',()=>{
 const h=harness();h.api.setItems([item('older',acquisition-35000),item('newer',acquisition)]);
 h.api.jumpToTime(acquisition-1);assert.equal(h.api.state().item,'older');
 h.api.jumpToTime(acquisition);assert.equal(h.api.state().item,'newer');
 h.api.jumpToTime(acquisition+1);assert.equal(h.api.state().item,'newer');
});
test('manual scene changes, repeated selection, and pass jumps use exact timestamps',()=>{
 const h=harness();const a=item('A',acquisition),b=item('B',acquisition+32123);h.api.setItems([a,b]);
 h.api.jumpToTime(acquisition-100);h.api.selectA(b);assert.equal(h.api.state().at,acquisition+32123);
 h.api.shiftTime(60);h.api.selectA(b);assert.equal(h.api.state().at,acquisition+32123);
 const pass={time:new Date(acquisition+123456789)};h.api.selectPass(pass);assert.equal(h.api.state().at,pass.time.getTime());
});
test('pause is stable, playback advances only on timer steps, hour shifts retain subminute precision, LIVE resumes',()=>{
 const h=harness();h.api.jumpToTime(acquisition);h.api.play();h.api.tick(true);assert.equal(h.api.state().at,acquisition+60000);
 h.api.tick();assert.equal(h.api.state().at,acquisition+60000);
 h.api.jumpToTime(acquisition);assert.equal(h.api.state().playing,false);
 h.advance(1300);h.api.shiftTime(60);assert.equal(h.api.state().at,acquisition+3600000);
 h.api.setOffset(0);assert.equal(h.api.state().fixedTimeMs,null);assert.equal(h.api.state().at,h.now());
 h.advance(900);h.api.tick();assert.equal(h.api.state().at,h.now());
});
test('sync-off preserves image choice, empty history is safe, and clock updates without TLE data',()=>{
 const h=harness();h.api.setItems([item('A',acquisition)]);h.api.jumpToTime(acquisition);h.api.setSync(false);
 h.api.jumpToTime(acquisition-100000);assert.equal(h.api.state().item,'A');
 h.api.setItems([]);assert.equal(h.api.sceneAt(new Date(acquisition)),undefined);
 h.api.noTle();h.api.jumpToTime(acquisition+123);assert.equal(h.api.state().at,acquisition+123);
});

test('relative offset badge stays compact with exact fractional-minute timestamps',()=>{
 const h=harness();assert.equal(h.api.formatOffset(493.246483333333),' +8h13m'.trim());
 assert.equal(h.api.formatOffset(-59.999),'−59m');assert.equal(h.api.formatOffset(0),'LIVE');
});
