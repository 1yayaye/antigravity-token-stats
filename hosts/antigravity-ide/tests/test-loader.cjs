const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const contract = require('../../../src/injection-contract.cjs');

const source = fs.readFileSync(path.join(__dirname, '../scripts/loader.cjs'), 'utf8');
const loaderDir = path.resolve('fixture-app/out/antitoken');
const workbenchUrl = pathToFileURL(path.resolve(loaderDir, '../vs/code/electron-browser/workbench/workbench.html')).href;
const home = path.join(os.tmpdir(), 'antitoken-loader-test-home');
const ideDataDir = path.join(home, '.gemini', 'antigravity-ide');
const current = { promptTokens: 1200, compactionLimit: 256000 };
const recent = { promptTokens: 9000, isRunning: true, lastActivityAt: '2099-01-01T00:00:00Z' };
const testCases = [];
const test = (name, run) => testCases.push({ name, run });

function chatFrame(options = {}) {
  let onMessage;
  const node = {
    src: options.src || 'http://127.0.0.1:3000/c/current-chat',
    contentWindow: {},
    getBoundingClientRect: () => ({ width: options.width ?? 800, height: options.height ?? 600 }),
  };
  const context = vm.createContext({
    URL,
    window: { addEventListener: (event, listener) => { if (event === 'message') onMessage = listener; } },
    document: {
      hidden: options.hidden || false,
      documentElement: { matches: () => options.host !== false },
      getElementById: id => id === contract.IDE_NATIVE_CHAT_RPC.iframeId && !options.missing ? node : null,
      querySelectorAll: () => [{ textContent: options.theme === false ? '' : '--vscode-sideBar-background' }],
    },
  });
  return {
    executeJavaScript: async code => vm.runInContext(code, context, { timeout: 100 }),
    send(route, event = {}, message = {}) {
      assert(onMessage, 'IPC discovery must install the native route observer first');
      onMessage({ source: node.contentWindow, origin: new URL(node.src).origin, ...event, data: {
        type: 'postmessage-rpc', channel: contract.IDE_NATIVE_CHAT_RPC.channel,
        source: contract.IDE_NATIVE_CHAT_RPC.source, rpcPath: contract.IDE_NATIVE_CHAT_RPC.path,
        payload: { path: route }, ...message,
      } });
    },
  };
}

function contents(windowId, frames = [], url = workbenchUrl) {
  const mainFrame = { url, executeJavaScript: async () => null };
  mainFrame.framesInSubtree = [mainFrame, ...frames];
  return {
    mainFrame, owner: { id: windowId }, destroyed: false,
    isDestroyed() { return this.destroyed; },
    getOwnerBrowserWindow() { return this.owner; },
    getURL: () => url,
    on() {},
  };
}

function loader(options = {}) {
  const sender = contents(1, options.frames || [chatFrame()]);
  const allContents = [sender, ...(options.otherContents || [])];
  const calls = { aggregate: [], single: [], quota: [], resolveProxy: [] };
  const stats = options.stats || { sessions: { 'current-chat': current, 'recent-other-chat': recent } };
  const env = { ...options.env };
  let sync;
  let readyHandler;
  const readFile = name => {
    if (String(name).endsWith('settings.json')) {
      if (options.settings === undefined) { const error = new Error('ENOENT'); error.code = 'ENOENT'; throw error; }
      if (options.settings === null) { const error = new Error('EACCES'); error.code = 'EACCES'; throw error; }
      return options.settings;
    }
    return '/* mocked UI bundle */';
  };
  const dependencies = {
    'node:fs': { readFileSync: readFile },
    'node:path': path,
    'node:os': { homedir: () => home },
    'jsonc-parser': {
      parse: options.jsoncParse || ((text, errors) => {
        try { return JSON.parse(text); } catch { errors.push({}); return undefined; }
      }),
    },
    electron: {
      app: {
        on() {},
        once(event, handler) { assert.equal(event, 'ready'); readyHandler = handler; },
        getPath: name => { assert.equal(name, 'userData'); return options.userDataDir || path.join(home, 'ide-user-data'); },
      },
      session: {
        defaultSession: {
          async resolveProxy(url) {
            calls.resolveProxy.push(url);
            if (typeof options.systemProxy === 'function') return options.systemProxy();
            return options.systemProxy ?? 'DIRECT';
          },
        },
      },
      webContents: { getAllWebContents: () => allContents },
      ipcMain: { handle(channel, handler) { assert.equal(channel, contract.IPC_IDE_SYNC); sync = handler; } },
      BrowserWindow: { fromWebContents: candidate => candidate.owner },
    },
    './injection-contract.cjs': contract,
    './aggregate-stats.cjs': {
      computeStats(...args) { calls.aggregate.push(args); return stats; },
      readSingleSession(...args) {
        calls.single.push(args);
        if (options.singleError) throw new Error('busy session DB');
        return options.single || null;
      },
    },
    './quota-service.cjs': {
      async fetchLiveQuota(...args) {
        calls.quota.push(args);
        if (typeof options.quotaPromise === 'function') return options.quotaPromise(...args);
        if (options.quotaPromise) return options.quotaPromise;
        if (options.quotaError) throw new Error('offline');
        return options.quotaResult ?? null;
      },
    },
  };
  const context = vm.createContext({
    __dirname: loaderDir, URL, Date: { now: () => 10000 }, console: { warn() {} },
    process: { env }, setTimeout, clearTimeout,
    require(name) { assert(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  vm.runInContext(source, context, { filename: 'IDE loader.cjs', timeout: 100 });
  assert.equal(typeof sync, 'function');
  assert.equal(typeof readyHandler, 'function', 'the loader must register its ready handler on import');
  return {
    sender, calls, stats, env, readyHandler,
    planProxyInheritance: context.planProxyInheritance,
    sync: (event, syncOptions) => sync(event || { sender, senderFrame: sender.mainFrame }, syncOptions),
  };
}

test('only the exact local workbench main frame can request IDE state', async () => {
  const host = loader();
  assert.equal(await host.sync({ sender: host.sender, senderFrame: { url: workbenchUrl } }), null);
  const pathname = new URL(workbenchUrl).pathname;
  for (const url of [
    'not a URL', `${workbenchUrl}.other`, `https://attacker.invalid${pathname}`,
    `file://attacker.invalid${pathname}`, `vscode-file://attacker.invalid${pathname}`,
  ]) {
    host.sender.mainFrame.url = url;
    assert.equal(await host.sync(), null, `Untrusted workbench URL: ${url}`);
  }
  assert.equal(host.calls.aggregate.length, 0);
  assert.equal(host.calls.quota.length, 0);
  host.sender.mainFrame.url = workbenchUrl;
  assert.equal((await host.sync()).activeSessionId, 'current-chat');
  host.sender.mainFrame.url = `vscode-file://vscode-app${pathname}`;
  assert.equal((await host.sync()).activeSessionId, 'current-chat');
});

test('visible current chat wins over recent/running chats and keeps the context limit unknown', async () => {
  const host = loader();
  const result = await host.sync();
  assert.equal(result.stats, host.stats);
  assert.equal(result.activeSessionId, 'current-chat');
  assert.equal(result.session, current);
  assert.equal(result.contextLimit, null, 'A recorded compaction limit is not a verified current context limit');
  assert.equal(result.sessionTitle, null);
  assert.deepEqual(host.calls.aggregate, [[true, ideDataDir]]);
  assert.deepEqual(host.calls.quota, [[false]]);
  assert.deepEqual(host.calls.single, []);
});

test('native route messages require the iframe source, origin, channel and RPC identity', async () => {
  const frame = chatFrame();
  const host = loader({ frames: [frame] });
  await host.sync();
  for (const [event, message] of [
    [{ source: {} }, {}], [{ origin: 'https://attacker.invalid' }, {}],
    [{}, { channel: 'other-channel' }], [{}, { source: 'other-source' }],
    [{}, { rpcPath: '/other-rpc' }], [{}, { type: 'other-type' }],
    [{}, { payload: { path: 123 } }],
  ]) {
    frame.send('/c/spoofed-chat', event, message);
    assert.equal((await host.sync()).activeSessionId, 'current-chat');
  }
  frame.send('/c/next-chat/');
  assert.equal((await host.sync()).activeSessionId, 'next-chat');
  for (const route of ['/settings', '/c/../../other', `/c/${'a'.repeat(129)}`]) {
    frame.send(route);
    const result = await host.sync();
    assert.equal(result.activeSessionId, null);
    assert.equal(result.session, null);
  }
});

test('remounted chat iframe rebinds route observer to the new frame', async () => {
  const firstNode = {
    src: 'http://127.0.0.1:3000/c/first-chat',
    contentWindow: {},
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  };
  const secondNode = {
    src: 'http://127.0.0.1:3000/c/second-chat',
    contentWindow: {},
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  };
  let activeNode = firstNode;
  let onMessage;
  const context = vm.createContext({
    URL,
    window: { addEventListener: (event, listener) => { if (event === 'message') onMessage = listener; } },
    document: {
      hidden: false,
      documentElement: { matches: () => true },
      getElementById: id => id === contract.IDE_NATIVE_CHAT_RPC.iframeId ? activeNode : null,
      querySelectorAll: () => [{ textContent: '--vscode-sideBar-background' }],
    },
  });
  const remountFrame = {
    executeJavaScript: async code => vm.runInContext(code, context, { timeout: 100 }),
  };
  const host = loader({
    frames: [remountFrame],
    stats: { sessions: { 'first-chat': current, 'second-chat': current, 'third-chat': current } },
  });
  assert.equal((await host.sync()).activeSessionId, 'first-chat');
  activeNode = secondNode;
  assert.equal((await host.sync()).activeSessionId, 'second-chat');
  onMessage({
    source: secondNode.contentWindow,
    origin: 'http://127.0.0.1:3000',
    data: {
      type: 'postmessage-rpc',
      channel: contract.IDE_NATIVE_CHAT_RPC.channel,
      source: contract.IDE_NATIVE_CHAT_RPC.source,
      rpcPath: contract.IDE_NATIVE_CHAT_RPC.path,
      payload: { path: '/c/third-chat' },
    },
  });
  assert.equal((await host.sync()).activeSessionId, 'third-chat');
});

test('hidden, untrusted and ambiguous routes never fall back to a recent session', async () => {
  for (const frames of [
    [], [chatFrame({ hidden: true })], [chatFrame({ width: 0 })], [chatFrame({ height: 0 })],
    [chatFrame({ missing: true })], [chatFrame({ host: false })], [chatFrame({ theme: false })],
    [chatFrame({ src: 'file:///c/current-chat' })],
    [chatFrame(), chatFrame({ src: 'http://127.0.0.1:3000/c/another-chat' })],
  ]) {
    const host = loader({ frames });
    const result = await host.sync();
    assert.equal(result.activeSessionId, null);
    assert.equal(result.session, null);
    assert.deepEqual(host.calls.single, []);
  }
  assert.equal((await loader({ frames: [chatFrame(), chatFrame()] }).sync()).activeSessionId, 'current-chat');
});

test('current chat discovery is isolated to the requesting window', async () => {
  const forbidden = { executeJavaScript() { throw new Error('Another window must never be inspected'); } };
  const other = contents(2, [forbidden]);
  const destroyed = contents(1, [forbidden]);
  destroyed.destroyed = true;
  const host = loader({ frames: [], otherContents: [other, destroyed] });
  assert.equal((await host.sync()).activeSessionId, null);
  const ownerless = loader();
  ownerless.sender.owner = null;
  assert.equal((await ownerless.sync()).activeSessionId, null);
});

test('missing aggregate session uses only its visible ID in the IDE data root', async () => {
  const host = loader({ stats: { sessions: { 'recent-other-chat': recent } }, single: current });
  const result = await host.sync();
  assert.equal(result.session, current);
  assert.deepEqual(host.calls.single, [['current-chat', ideDataDir]]);
  const busy = loader({ stats: { sessions: {} }, singleError: true });
  assert.equal((await busy.sync()).session, null, 'A busy or missing session is unavailable, not zero');
});

test('a rejected frame evaluation does not hide another valid visible chat', async () => {
  const failing = { executeJavaScript: async () => { throw new Error('Frame detached'); } };
  const host = loader({ frames: [failing, chatFrame()], quotaError: true });
  const result = await host.sync();
  assert.equal(result.activeSessionId, 'current-chat');
  assert.equal(result.quota, null);
});

test('a synchronous frame lifecycle error does not reject IDE state sync', async () => {
  const failing = { executeJavaScript() { throw new Error('Frame disposed before execution'); } };
  const host = loader({ frames: [failing, chatFrame()] });
  assert.equal((await host.sync()).activeSessionId, 'current-chat');
});

test('a disposed contents frame tree does not reject IDE state sync', async () => {
  const disposed = contents(1);
  Object.defineProperty(disposed.mainFrame, 'framesInSubtree', { get() { throw new Error('Frame tree disposed'); } });
  const host = loader({ otherContents: [disposed] });
  assert.equal((await host.sync()).activeSessionId, 'current-chat');
});

test('the resolved system proxy is inherited once at ready with local bypass', async () => {
  const host = loader({ systemProxy: 'PROXY 127.0.0.1:7890' });
  assert.deepEqual(host.calls.resolveProxy, [], 'nothing may resolve before ready fires');
  assert.deepEqual(host.env, {}, 'no env changes before ready fires');
  await host.readyHandler();
  assert.deepEqual(host.calls.resolveProxy, ['https://oauth2.googleapis.com/token']);
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) {
    assert.equal(host.env[key], 'http://127.0.0.1:7890', `${key} must carry the inherited proxy`);
  }
  for (const key of ['NO_PROXY', 'no_proxy']) {
    assert.equal(host.env[key], 'localhost,127.0.0.1,::1', `${key} must keep local addresses direct`);
  }
});

test('explicit proxy env vars disable inheritance without any resolution', async () => {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) {
    const host = loader({ env: { [key]: 'http://10.0.0.1:3128' }, systemProxy: 'PROXY 127.0.0.1:7890' });
    await host.readyHandler();
    assert.deepEqual(host.calls.resolveProxy, [], `resolution must not run with explicit ${key}`);
    assert.deepEqual(host.env, { [key]: 'http://10.0.0.1:3128' });
  }
});

test('a configured http.proxy setting disables inheritance', async () => {
  const host = loader({ settings: '{ "http.proxy": "http://10.0.0.2:3128" }', systemProxy: 'PROXY 127.0.0.1:7890' });
  await host.readyHandler();
  assert.deepEqual(host.calls.resolveProxy, [], 'an explicit setting must be honored without resolution');
  assert.deepEqual(host.env, {}, 'the native host already applies the setting itself');
});

test('unreadable or unparseable settings disable inheritance', async () => {
  for (const [name, options] of [
    ['existing but unreadable settings', { settings: null }],
    ['settings with parse errors', {
      settings: '{"http.proxy": ',
      jsoncParse: (text, errors) => { errors.push({}); return {}; },
    }],
    ['settings with a non-object shape', {
      settings: '[]',
      jsoncParse: () => [],
    }],
  ]) {
    const host = loader({ ...options, systemProxy: 'PROXY 127.0.0.1:7890' });
    await host.readyHandler();
    assert.deepEqual(host.calls.resolveProxy, [], `resolution must not run with ${name}`);
    assert.deepEqual(host.env, {}, `nothing may be inherited with ${name}`);
  }
});

test('DIRECT and SOCKS resolutions leave the environment untouched', async () => {
  for (const systemProxy of ['DIRECT', 'SOCKS 127.0.0.1:1080', 'SOCKS5 127.0.0.1:1080', '']) {
    const host = loader({ systemProxy });
    await host.readyHandler();
    assert.deepEqual(host.env, {}, `nothing may be inherited from ${JSON.stringify(systemProxy)}`);
  }
});

test('an existing NO_PROXY is preserved when inheriting the system proxy', async () => {
  const host = loader({ env: { NO_PROXY: 'internal.corp' }, systemProxy: 'PROXY 127.0.0.1:7890' });
  await host.readyHandler();
  assert.equal(host.env.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(host.env.NO_PROXY, 'internal.corp');
  assert.equal(host.env.no_proxy, undefined, 'a differently cased NO_PROXY must not be duplicated');
});

test('HTTPS proxy resolutions keep their scheme and fallback chains use the first entry', async () => {
  const https = loader({ systemProxy: 'HTTPS proxy.corp.example:443' });
  await https.readyHandler();
  assert.equal(https.env.HTTP_PROXY, 'https://proxy.corp.example:443');
  assert.equal(https.env.HTTPS_PROXY, 'https://proxy.corp.example:443');
  const chain = loader({ systemProxy: 'PROXY 127.0.0.1:7890; PROXY 127.0.0.1:7891' });
  await chain.readyHandler();
  assert.equal(chain.env.HTTP_PROXY, 'http://127.0.0.1:7890');
});

test('a failing or stalled proxy resolution leaves the environment untouched', async () => {
  const host = loader({ systemProxy: () => { throw new Error('network service unavailable'); } });
  await host.readyHandler();
  assert.deepEqual(host.env, {}, 'a failed resolution must change nothing');
  const stalled = loader({ systemProxy: () => new Promise(() => {}) });
  let bail;
  try {
    await Promise.race([
      stalled.readyHandler(),
      new Promise((_, reject) => { bail = setTimeout(() => reject(new Error('inheritance must not hang on a stalled resolution')), 8000); }),
    ]);
  } finally { clearTimeout(bail); }
  assert.deepEqual(stalled.env, {}, 'a stalled resolution must change nothing');
});

test('IPC_IDE_SYNC honors explicit forceQuota=true and sanitizes invalid options', async () => {
  const host = loader({ quotaResult: { capturedAt: '2026-11-16T00:00:00Z' } });
  await host.sync(undefined, null);
  await host.sync(undefined, 'invalid');
  await host.sync(undefined, { forceQuota: 'yes' });
  assert.deepEqual(host.calls.quota, [[false], [false], [false]], 'non-boolean or invalid options must fall back to throttled fetchLiveQuota(false)');

  const forced = await host.sync(undefined, { forceQuota: true });
  assert.deepEqual(host.calls.quota.at(-1), [true], 'explicit forceQuota:true must trigger fetchLiveQuota(true)');
  assert.equal(forced.quota?.capturedAt, '2026-11-16T00:00:00Z', 'forced refresh must await and return fresh quota');

  // Non-forced poll in flight + user clicks force refresh -> awaits poll, then executes single-flight forceQuota(true).
  let resolveBackground;
  let resolveForced;
  const raceHost = loader({
    quotaPromise(force) {
      if (!force) return new Promise(resolve => { resolveBackground = resolve; });
      return new Promise(resolve => { resolveForced = resolve; });
    },
  });
  const bgPoll = raceHost.sync();
  const forceClick1 = raceHost.sync(undefined, { forceQuota: true });
  const forceClick2 = raceHost.sync(undefined, { forceQuota: true });
  assert.deepEqual(raceHost.calls.quota, [[false]], 'background poll starts once');
  resolveBackground({ capturedAt: '2026-11-16T00:01:00Z' });
  await bgPoll;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(raceHost.calls.quota, [[false], [true]], 'concurrent force refreshes coalesce into one fetchLiveQuota(true) after background poll');
  resolveForced({ capturedAt: '2026-11-16T00:02:00Z' });
  const [res1, res2] = await Promise.all([forceClick1, forceClick2]);
  assert.equal(res1.quota?.capturedAt, '2026-11-16T00:02:00Z');
  assert.equal(res2.quota?.capturedAt, '2026-11-16T00:02:00Z');
});

(async () => {
  let failed = 0;
  for (const { name, run } of testCases) {
    try { await run(); console.log(`PASS: ${name}`); }
    catch (error) { failed++; console.error(`FAIL: ${name}\n${error.stack}`); }
  }
  console.log(`IDE loader: ${testCases.length - failed}/${testCases.length} cases passed`);
  if (failed) process.exitCode = 1;
})();
