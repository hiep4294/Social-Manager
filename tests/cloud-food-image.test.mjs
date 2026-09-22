import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as food from '../src/food-network-core.js';

// Execute the real daily pipeline with isolated filesystem, image and network boundaries.
// No Facebook calls, credentials, or recipe-state changes leave this test.
const source = fs.readFileSync(new URL('../scripts/cloud-food-daily.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const run = new (Object.getPrototypeOf(async function() {}).constructor)(
  'fs', 'crypto', 'path', 'sharp', 'process', 'fetch', 'console',
  ...Object.keys(food), source
);

async function scenario(mode) {
  const writes = new Map();
  let posts = 0;
  let renders = 0;
  const exit = {};
  let exitCode = 0;
  const fakeFs = {
    mkdirSync() {}, existsSync: () => false,
    writeFileSync(file, value) { writes.set(file, value); },
    readFileSync: () => Buffer.from('test image')
  };
  const fakeProcess = {
    env: { FACEBOOK_PAGE_ID:'test-page', FACEBOOK_PAGE_ACCESS_TOKEN:'test-token',
      FOOD_DATE:'2026-09-22', CLOUD_FOOD_PUBLISH:'true' },
    cwd: () => path.resolve('isolated-test'),
    exit(code) { exitCode = code; throw exit; }
  };
  const sharp = () => {
    renders++;
    if (mode === 'invalid-image') throw new Error('Image cannot be decoded');
    const chain = { resize: () => chain, jpeg: () => chain, composite: () => chain,
      toBuffer: async () => Buffer.from('image'), toFile: async () => {} };
    return chain;
  };
  const response = data => ({ ok:true, json:async () => data });
  const fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.hostname === 'graph.facebook.com') {
      if (options.method === 'POST') { posts++; return response({ post_id:'test-post' }); }
      if (u.pathname.endsWith('/me')) return response({ id:'test-page' });
      if (u.pathname.endsWith('/posts')) return response({ data:[] });
      throw new Error('Unexpected Graph request');
    }
    if (u.hostname === 'commons.wikimedia.org') {
      if (mode === 'search-error') throw new Error('Search unavailable');
      if (mode === 'missing') return response({ query:{ pages:{} } });
      const title = u.searchParams.get('gsrsearch').replaceAll('"','');
      return response({ query:{ pages:{ 1:{ title, index:1, imageinfo:[{
        mime:'image/jpeg', url:'https://images.example/food.jpg',
        extmetadata:{ LicenseShortName:{ value:'CC0' } }
      }] } } } });
    }
    if (u.hostname === 'images.example') return {
      ok:mode !== 'download-error', status:503, arrayBuffer:async () => new ArrayBuffer(8)
    };
    throw new Error('Unexpected network request');
  };
  try {
    await run(fakeFs, crypto, path, sharp, fakeProcess, fetch,
      { log() {}, error() {} }, ...Object.values(food));
  } catch (error) { if (error !== exit) throw error; }
  const resultFile = [...writes.keys()].find(x => x.endsWith('-result.json'));
  const result = JSON.parse(writes.get(resultFile));
  const stateWrites = [...writes.keys()].filter(x => x.includes('recipe-state'));
  return { posts, renders, exitCode, result, stateWrites };
}

for (const mode of ['missing', 'search-error', 'download-error', 'invalid-image']) {
  const actual = await scenario(mode);
  assert.equal(actual.posts, 0, `${mode}: must not publish`);
  assert.equal(actual.exitCode, 1, `${mode}: must report failure`);
  assert.equal(actual.result.status, 'WAITING_IMAGE');
  assert.equal(actual.result.published, null);
  assert.deepEqual(actual.stateWrites, [], `${mode}: must not consume recipe`);
  if (mode === 'missing' || mode === 'search-error') assert.equal(actual.renders, 0);
}
const success = await scenario('photo');
assert.equal(success.exitCode, 0);
assert.equal(success.posts, 1);
assert.equal(success.result.status, 'PUBLISHED');
assert.equal(success.stateWrites.length, 2);
console.log('Cloud food image guard: 5 scenarios passed');
