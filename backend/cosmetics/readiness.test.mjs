import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseCosmeticsStore } from './store.mjs';
import { initializeCosmetics } from './readiness.mjs';

test('readiness probes schema without retrieving private records', async () => {
  const paths = [];
  const store = new SupabaseCosmeticsStore({url:'https://storage.example', key:'test-only', fetcher:async (url, init) => {
    paths.push(new URL(url).pathname + new URL(url).search);
    assert.equal(init.method, 'GET');
    return Response.json(url.includes('/bucket/')
      ? {public:false,file_size_limit:33554432,allowed_mime_types:['image/png']} : []);
  }});
  await store.checkReadiness();
  assert.equal(paths.length, 5);
  assert.ok(paths.slice(0,4).every(path => path.endsWith('&limit=0')));
});

test('readiness refuses public, unlimited or permissive buckets', async () => {
  for (const bucket of [
    {public:true,file_size_limit:33554432,allowed_mime_types:['image/png']},
    {public:false,file_size_limit:null,allowed_mime_types:['image/png']},
    {public:false,file_size_limit:33554433,allowed_mime_types:['image/png']},
    {public:false,file_size_limit:33554432,allowed_mime_types:['image/*']},
  ]) {
    const store = new SupabaseCosmeticsStore({url:'https://storage.example',key:'test-only',
      fetcher:async url => Response.json(url.includes('/bucket/') ? bucket : [])});
    await assert.rejects(store.checkReadiness(), /unsafe_cape_bucket/);
  }
});

test('readiness rejects unreachable or unmigrated storage', async () => {
  const store = new SupabaseCosmeticsStore({url:'https://storage.example',key:'test-only',
    fetcher:async () => new Response('private provider detail', {status:404})});
  await assert.rejects(store.checkReadiness(), /cosmetics_storage_unavailable/);
});

test('incomplete activation closes capes without throwing or exposing configuration', async () => {
  const messages = [];
  const api = await initializeCosmetics({BLOOM_COSMETICS_ENABLED:'true'}, message => messages.push(message));
  assert.equal(api.enabled, false);
  assert.equal(messages.length, 1);
  assert.equal((await initializeCosmetics({}, () => assert.fail('disabled is normal'))).enabled, false);
});
