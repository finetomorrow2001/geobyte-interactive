import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('./i18n/locale.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {resolveLanguage,languageUrl}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('explicit demo locale overrides saved preference; invalid locales retain saved/browser fallback',()=>{
 assert.equal(resolveLanguage('en','ja','ja-JP'),'en');
 assert.equal(resolveLanguage('ja','en','en-US'),'ja');
 assert.equal(resolveLanguage(null,'en','ja-JP'),'en');
 assert.equal(resolveLanguage('invalid','ja','en-US'),'ja');
 assert.equal(resolveLanguage(null,null,'ja-JP'),'ja');
 assert.equal(resolveLanguage(null,null,'en-US'),'en');
});
test('language switching preserves scene, boundary, other query parameters and fragment',()=>{
 const original='https://app.test/imagery?item=A&compare=B&bbox=1,2,3,4&lang=ja#series-chart';
 const url=new URL(languageUrl(original,'en'),'https://app.test');
 assert.equal(url.pathname,'/imagery');assert.equal(url.searchParams.get('item'),'A');assert.equal(url.searchParams.get('compare'),'B');assert.equal(url.searchParams.get('bbox'),'1,2,3,4');assert.equal(url.hash,'#series-chart');assert.deepEqual(url.searchParams.getAll('lang'),['en']);
 assert.equal(languageUrl('/field','en'),'/field?lang=en');
});
