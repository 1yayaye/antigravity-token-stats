const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const contract = require('../src/injection-contract.cjs');

require.extensions['.ts'] = (mod, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  mod._compile(compiled, filename);
};
require.extensions['.tsx'] = require.extensions['.ts'];
require.extensions['.css'] = () => {};
const { requestDataSync } = require('../hosts/antigravity/src/standalone.tsx');

const response = { groups: [{ displayName: 'Gemini Models', buckets: [
  { bucketId: 'gemini-weekly', remainingFraction: 0.7, resetTime: '2026-11-20T00:00:00Z' },
] }] };
const nextTurn = () => new Promise(setImmediate);
const tests = [];
const test = (name, run) => tests.push({ name, run });

function setup() {
  const cleanups = [];
  const updates = [];
  let calls = 0;
  let fail = false;
  let now = Date.now();
  const originalNow = Date.now;
  const originalLoad = Module._load;
  const react = {
    useEffect: callback => { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); },
    useMemo: factory => factory(),
    useState: initial => [typeof initial === 'function' ? initial() : initial, value => updates.push(value)],
  };
  Module._load = function (name, ...args) {
    return name === 'react' ? react : originalLoad.call(this, name, ...args);
  };
  Date.now = () => now;
  global.window = new EventTarget();
  const cloudCodeService = { retrieveUserQuotaSummary: async () => {
    calls++;
    await nextTurn();
    if (fail) throw new Error('Temporary RPC failure');
    return { response };
  } };
  global.document = { querySelector: () => ({
    __reactFiber_test: { memoizedProps: { services: { core: { cloudCodeService } } } },
  }) };
  const quotaPath = require.resolve('../hosts/antigravity/src/quota.ts');
  const hookPath = require.resolve('../src/components/stats/useQuotaMetrics.ts');
  delete require.cache[quotaPath];
  delete require.cache[hookPath];
  const { fetchLiveQuota, startQuotaUpdates } = require(quotaPath);
  return {
    fetchLiveQuota,
    startQuotaUpdates,
    updates,
    get calls() { return calls; },
    advance: ms => { now += ms; },
    fail: value => { fail = value; },
    mount: () => {
      const { EMPTY_STATS } = require('../src/services/stats-service.ts');
      require(hookPath).useQuotaMetrics(EMPTY_STATS);
      cleanups.push(startQuotaUpdates());
    },
    dispose: () => {
      cleanups.forEach(cleanup => cleanup());
      Date.now = originalNow;
      Module._load = originalLoad;
      delete global.window;
      delete global.document;
    },
  };
}

test('session heartbeats never force quota RPCs inside the TTL', async env => {
  env.mount();
  await nextTurn();
  assert.equal(env.calls, 1);
  for (let i = 0; i < 5; i++) {
    env.advance(1000);
    window.dispatchEvent(new CustomEvent(contract.EVENT_REQUEST_SYNC, { detail: { sessionId: 'fixture' } }));
    await nextTurn();
  }
  assert.equal(env.calls, 1);
  window.dispatchEvent(new CustomEvent(contract.EVENT_REQUEST_SYNC));
  await nextTurn();
  assert.equal(env.calls, 2, 'manual refresh still bypasses the TTL');
});

test('dashboard refresh keeps its full scope while a conversation is open', async env => {
  const requests = [];
  window.location = { pathname: '/c/fixture' };
  window[contract.WINDOW_SYNC_BRIDGE] = { requestSync: payload => { requests.push(payload); return Promise.resolve(); } };
  requestDataSync('fixture');
  requestDataSync();
  assert.deepEqual(requests, [{ sessionId: 'fixture' }, { sessionId: null }]);
});

test('concurrent quota reads share one RPC, including forced reads', async env => {
  const values = await Promise.all([env.fetchLiveQuota(), env.fetchLiveQuota(), env.fetchLiveQuota(true)]);
  assert.equal(env.calls, 1);
  assert.ok(values[0]?.weeklyGemini);
  assert.strictEqual(values[0], values[1]);
  assert.strictEqual(values[1], values[2]);
});

test('TTL expires and manual refresh bypasses cached quota', async env => {
  await env.fetchLiveQuota();
  env.advance(29_000);
  await env.fetchLiveQuota();
  assert.equal(env.calls, 1);
  await env.fetchLiveQuota(true);
  assert.equal(env.calls, 2);
  env.advance(30_001);
  await env.fetchLiveQuota();
  assert.equal(env.calls, 3);
});

test('a failed request preserves the last quota and allows retry', async env => {
  const first = await env.fetchLiveQuota();
  env.fail(true);
  assert.strictEqual(await env.fetchLiveQuota(true), first);
  env.fail(false);
  assert.ok((await env.fetchLiveQuota(true))?.weeklyGemini);
  assert.equal(env.calls, 3);
});

test('failed automatic reads are throttled without preventing later retries', async env => {
  env.fail(true);
  assert.equal(await env.fetchLiveQuota(), null);
  env.advance(1000);
  assert.equal(await env.fetchLiveQuota(), null);
  assert.equal(env.calls, 1);
  env.advance(30_001);
  env.fail(false);
  assert.ok((await env.fetchLiveQuota())?.weeklyGemini);
  assert.equal(env.calls, 2);
});

test('quota snapshots update the view independently and null clears stale quota', async env => {
  env.mount();
  await nextTurn();
  assert.ok(env.updates.at(-1)?.weeklyGemini);
  window[contract.WINDOW_LIVE_QUOTA] = null;
  window.dispatchEvent(new CustomEvent(contract.EVENT_QUOTA_UPDATED, { detail: null }));
  assert.equal(env.updates.at(-1), null);
});

test('disposing host quota updates removes refresh listeners', async env => {
  const stop = env.startQuotaUpdates();
  await nextTurn();
  stop();
  window.dispatchEvent(new CustomEvent(contract.EVENT_REQUEST_SYNC));
  env.advance(30_001);
  window.dispatchEvent(new CustomEvent(contract.EVENT_STATS_UPDATED));
  await nextTurn();
  assert.equal(env.calls, 1);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    const env = setup();
    try { await run(env); console.log(`PASS: ${name}`); }
    catch (error) { failures++; console.error(`FAIL: ${name}\n${error.stack}`); }
    finally { env.dispose(); }
  }
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
