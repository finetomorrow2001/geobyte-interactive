import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { BaseClient, BaseResponse } from 'geotiff';

async function loadCog(fromCustomClient) {
  const source = await readFile(new URL('./cog.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source + '\nexport { getInternalTile };', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  }).outputText;
  const key = `__cogTest${Math.random().toString(36).slice(2)}`;
  globalThis[key] = { fromCustomClient, BaseClient, BaseResponse, Pool: class {} };
  const module = await import('data:text/javascript;base64,' + Buffer.from(code.replace(/import[^;]+from ['"]geotiff['"];?/, `const {fromCustomClient, BaseClient, BaseResponse, Pool} = globalThis.${key};`)).toString('base64'));
  delete globalThis[key];
  return module;
}

function image(readRasters) {
  return { getTileWidth: () => 1, getTileHeight: () => 1,
    getWidth: () => 100, getHeight: () => 100, readRasters };
}

test('COG headers share one open and enable bounded Range caching; failed opens retry', async () => {
  let calls = 0;
  const base = { getOrigin: () => [0, 0], getResolution: () => [10, -10],
    getGDALNoData: () => 0, getWidth: () => 100, getHeight: () => 100,
    getSamplesPerPixel: () => 3 };
  const cog = await loadCog(async (_url, options) => {
    calls++;
    assert.deepEqual(options, { allowFullFile: false });
    assert.equal(_url.url, 'scene');
    if (calls === 1) throw Error('temporary network error');
    return { getImageCount: async () => 1, getImage: async () => base };
  });
  await assert.rejects(cog.openCog('scene'));
  const [a, b] = await Promise.all([cog.openCog('scene'), cog.openCog('scene')]);
  assert.equal(a, b);
  assert.equal(calls, 2);
});

test('internal tiles deduplicate pending reads, reuse warm data, and retain active reads under pressure', async () => {
  const cog = await loadCog(() => { throw Error('unused'); });
  let calls = 0, complete;
  const img = image(async ({ window: [x] }) => {
    calls++;
    if (x === 99) return new Promise(resolve => { complete = resolve; });
    // ArrayLike fallback accounts for 8 MiB without allocating large arrays.
    return [{ length: 1024 * 1024 }];
  });
  const info = { images: [img] };
  const pending = cog.getInternalTile(info, 'scene', 0, 99, 0);
  assert.equal(pending, cog.getInternalTile(info, 'scene', 0, 99, 0));
  for (let x = 0; x < 8; x++) await cog.getInternalTile(info, 'scene', 0, x, 0);
  assert.equal(pending, cog.getInternalTile(info, 'scene', 0, 99, 0));
  complete([{ length: 1, 0: 42 }]);
  const tile = await pending;
  assert.equal((await cog.getInternalTile(info, 'scene', 0, 99, 0)).data[0][0], 42);
  assert.equal(await cog.getInternalTile(info, 'scene', 0, 99, 0), tile);
  const before = calls;
  await cog.getInternalTile(info, 'scene', 0, 0, 0);
  assert.equal(calls, before + 1, 'old data is evicted to respect the byte budget');
});

test('failed internal reads can be retried', async () => {
  const cog = await loadCog(() => {});
  let calls = 0;
  const info = { images: [image(async () => {
    if (++calls === 1) throw Error('temporary failure');
    return [new Uint8Array([7])];
  })] };
  await assert.rejects(cog.getInternalTile(info, 'scene', 0, 0, 0));
  const result = await cog.getInternalTile(info, 'scene', 0, 0, 0);
  assert.equal(result.data[0][0], 7);
});

test('header prefix is shared while concurrent pixel ranges stay exact and independent', async () => {
  const { HeaderRangeClient } = await loadCog(() => {});
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, { headers }) => {
    const value = new Headers(headers).get('range'); requests.push(value);
    const [, a, b] = value.match(/bytes=(\d+)-(\d+)/);
    const start = Number(a), end = Number(b);
    return new Response(new Uint8Array(end - start + 1).fill(start % 251), {
      status: 206, headers: { 'content-range': `bytes ${start}-${end}/10000000` }
    });
  };
  try {
    const client = new HeaderRangeClient('scene');
    await Promise.all(Array.from({ length: 40 }, async (_, i) => {
      const response = await client.request({ headers: { Range: `bytes=${i * 100}-${i * 100 + 99}` } });
      assert.equal(response.status, 206);
      assert.equal((await response.getData()).byteLength, 100);
    }));
    assert.deepEqual(requests, ['bytes=0-65535']);
    await Promise.all(Array.from({ length: 40 }, async (_, i) => {
      const start = 65536 + i * 128;
      const response = await client.request({ headers: { Range: `bytes=${start}-${start + 127}` } });
      const data = new Uint8Array(await response.getData());
      assert.equal(data.length, 128);
      assert.ok(data.every(v => v === start % 251));
    }));
    assert.equal(requests.length, 41);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(client.request({ headers: { Range: 'bytes=0-9' }, signal: controller.signal }), { name: 'AbortError' });
  } finally { globalThis.fetch = originalFetch; }
});

test('header client retries network failures and rejects full-file responses', async () => {
  const { HeaderRangeClient } = await loadCog(() => {});
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw Error('network');
    return new Response(new Uint8Array(65536), {
      status: 206, headers: { 'content-range': 'bytes 0-65535/100000' }
    });
  };
  try {
    const client = new HeaderRangeClient('scene');
    await assert.rejects(client.request({ headers: { Range: 'bytes=0-9' } }));
    assert.equal((await client.request({ headers: { Range: 'bytes=0-9' } })).status, 206);
    assert.equal(calls, 2);
    globalThis.fetch = async () => new Response('not a range response', { status: 200 });
    await assert.rejects(new HeaderRangeClient('other').request({ headers: { Range: 'bytes=0-9' } }), /Range/);
  } finally { globalThis.fetch = originalFetch; }
});

test('HTTP 206 works when CORS hides Content-Range from browser JavaScript', async () => {
  const { HeaderRangeClient } = await loadCog(() => {});
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(new Uint8Array(65536).fill(7), { status: 206 }); };
  try {
    const client = new HeaderRangeClient('s3-cors-scene');
    const response = await client.request({ headers: { Range: 'bytes=128-255' } });
    assert.equal(response.status, 206);
    assert.equal(response.getHeader('content-range'), undefined);
    assert.deepEqual(new Uint8Array(await response.getData()), new Uint8Array(128).fill(7));
    await client.request({ headers: { Range: 'bytes=0-1023' } });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
