import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022
} }).outputText;
const dataUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const affinity = dataUrl(compile(await readFile(new URL('./worker-affinity.ts', import.meta.url), 'utf8')));
const reflectance = dataUrl(compile(await readFile(new URL('./reflectance.ts', import.meta.url), 'utf8')));
const source = compile(await readFile(new URL('./imagery.ts', import.meta.url), 'utf8'))
  .replace(/from ['"]\.\/worker-affinity['"]/g, 'from ' + JSON.stringify(affinity))
  .replace(/from ['"]\.\/reflectance['"]/g, 'from ' + JSON.stringify(reflectance))
  .replace(/new URL\(['"]\.\/cog.worker.ts['"], import.meta.url\)/g, "new URL('file:///test/cog.worker.js')");
const posted = [];
let count = 0;
const oldWorker = globalThis.Worker;
const navDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
class FakeWorker {
  constructor() { this.slot = count++; }
  postMessage(job) {
    posted.push({ slot: this.slot, job });
    queueMicrotask(() => this.onmessage({ data: { id: job.id, rgba: new Uint8ClampedArray(4), requests: 0 } }));
  }
}

test('NDVI dispatch preserves all operands, coordinates, size and gain while sharing one scene worker', async () => {
  globalThis.Worker = FakeWorker;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hardwareConcurrency: 5 } });
  try {
    const { renderTile } = await import(dataUrl(source));
    const item = id => ({ id, properties: { 'proj:epsg': 32654 }, assets: {
      nir: { href: `https://example.test/${id}/nir.tif` },
      red: { href: `https://example.test/${id}/red.tif` },
      visual: { href: `https://example.test/${id}/visual.tif` }
    } });
    await renderTile(item('a'), { kind: 'index', id: 'ndvi' }, 1.5, 11, 100, 200, 256);
    await renderTile(item('a'), { kind: 'index', id: 'ndvi' }, 1.5, 12, 300, 400, 512);
    await renderTile(item('b'), { kind: 'index', id: 'ndvi' }, 1.5, 11, 100, 200, 256);
    assert.equal(count, 4);
    assert.equal(posted[0].slot, posted[1].slot);
    assert.notEqual(posted[0].slot, posted[2].slot);
    const { id, ...job } = posted[0].job;
    assert.deepEqual(job, { kind: 'tile', epsg: 32654, z: 11, x: 100, y: 200, size: 256,
      gain: 1.5, mode: 'index', hrefs: ['https://example.test/a/nir.tif', 'https://example.test/a/red.tif'], cmap: 'rdylgn' });
    assert.equal(posted[1].job.size, 512);
    assert.equal(posted[1].job.z, 12);
    for (const [x, y] of [[100, 200], [102, 200], [100, 202], [102, 202]]) {
      await renderTile(item('a'), { kind: 'composite', id: 'tci' }, 1, 11, x, y, 256);
      assert.equal(posted.at(-1).slot, ((((x >> 1) * 31 + (y >> 1)) >>> 0) % 4));
      assert.equal(posted.at(-1).job.mode, 'composite');
      assert.deepEqual(posted.at(-1).job.hrefs, ['https://example.test/a/visual.tif']);
    }
  } finally {
    globalThis.Worker = oldWorker;
    if (navDescriptor) Object.defineProperty(globalThis, 'navigator', navDescriptor);
    else delete globalThis.navigator;
  }
});
