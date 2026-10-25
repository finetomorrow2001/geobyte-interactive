import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('./worker-affinity.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022
} }).outputText;
const { createSceneAffinity } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('all tiles and modes of one scene retain one worker', () => {
  const choose = createSceneAffinity();
  const a = choose('scene-a', 4);
  for (let i = 0; i < 1000; i++) assert.equal(choose('scene-a', 4), a);
});
test('successive A/B scenes use different workers, including a two-worker device', () => {
  for (const count of [2, 3, 4]) {
    const choose = createSceneAffinity();
    const a = choose('a', count), b = choose('b', count);
    assert.notEqual(a, b);
    assert.equal(choose('a', count), a);
    assert.equal(choose('b', count), b);
    for (let i = 0; i < 100; i++) assert.ok(choose(`scene-${i}`, count) < count);
  }
});
test('affinity metadata is bounded and hot scenes survive LRU pressure', () => {
  const choose = createSceneAffinity(2);
  assert.equal(choose('a', 4), 0);
  assert.equal(choose('b', 4), 1);
  assert.equal(choose('a', 4), 0);
  assert.equal(choose('c', 4), 2);
  assert.equal(choose('a', 4), 0);
  assert.equal(choose('b', 4), 3);
});
test('invalid capacities and worker counts are rejected', () => {
  for (const n of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => createSceneAffinity(n), RangeError);
    assert.throws(() => createSceneAffinity()('scene', n), RangeError);
  }
});
test('a changed worker count still returns valid stable owner slots', () => {
  const choose = createSceneAffinity();
  for (let i = 0; i < 4; i++) choose(String(i), 4);
  assert.equal(choose('3', 2), 1);
  assert.equal(choose('3', 2), 1);
});
