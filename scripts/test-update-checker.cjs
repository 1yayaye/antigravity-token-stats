const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'hosts/antigravity/scripts/update-checker.cjs'), 'utf8');
const SIX_HOURS = 6 * 60 * 60 * 1000;

function release(tag = 'v1.10.0') {
  const name = `antigravity-token-stats-v${tag.replace(/^v/, '')}-setup.exe`;
  return {
    tag_name: tag, draft: false, prerelease: false,
    assets: [{ name, state: 'uploaded', size: 1234,
      browser_download_url: `https://github.com/1yayaye/antigravity-token-stats/releases/download/${tag}/${name}` }],
  };
}

function harness() {
  let timerId = 0;
  const h = {
    timers: new Map(), requests: [], notices: [], downloads: [], warnings: [],
    release: release(), status: 200, choice: 1, languages: ['en-US'],
  };
  h.fetch = async () => ({ ok: h.status === 200, status: h.status, json: async () => h.release });
  h.electron = {
    app: Object.assign(new EventEmitter(), { getPreferredSystemLanguages: () => h.languages }),
    net: { fetch: async (url, options) => { h.requests.push({ url, options }); return h.fetch(url, options); } },
    dialog: { showMessageBox: async options => { h.notices.push(options); return { response: h.choice }; } },
    shell: { openExternal: async url => { h.downloads.push(url); } },
  };
  const module = { exports: {} };
  h.context = {
    module, AbortController,
    setTimeout: (fn, ms) => { h.timers.set(++timerId, { fn, ms }); return timerId; },
    setInterval: (fn, ms) => { h.timers.set(++timerId, { fn, ms, repeat: true }); return timerId; },
    clearTimeout: id => h.timers.delete(id),
    clearInterval: id => h.timers.delete(id),
    console: { warn: (...args) => h.warnings.push(args.join(' ')) },
  };
  vm.runInNewContext(source, h.context, { filename: 'update-checker.cjs' });
  h.start = (version = '1.9.0') => module.exports.startUpdateChecks(h.electron, version);
  h.fire = async ms => {
    const [id, timer] = [...h.timers].find(([, item]) => item.ms === ms) || [];
    assert.ok(timer, `Expected a ${ms}ms timer`);
    if (!timer.repeat) h.timers.delete(id);
    await timer.fn();
  };
  return h;
}

test('checks after 10 seconds, repeats every 6 hours, and starts only once', async () => {
  const h = harness();
  h.start();
  h.start();
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 2);
  await h.fire(10_000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://api.github.com/repos/1yayaye/antigravity-token-stats/releases/latest');
  assert.equal(h.requests[0].options.headers['User-Agent'], 'AntiToken/1.9.0');
  assert.equal(h.requests[0].options.credentials, 'omit');
  assert.equal(h.requests[0].options.redirect, 'error');
  await h.fire(SIX_HOURS);
  assert.equal(h.requests.length, 2);
  assert.equal(h.notices.length, 1);
  assert.equal(h.timers.size, 1);
});

for (const version of ['v1.9.0', 'v1.8.9', 'v0.99.99']) {
  test(`does not prompt for installed or older version ${version}`, async () => {
    const h = harness();
    h.release = release(version);
    h.start();
    await h.fire(10_000);
    assert.equal(h.notices.length, 0);
    assert.equal(h.downloads.length, 0);
    assert.equal(h.warnings.length, 0);
  });
}

for (const version of ['v1.10.0', 'v2.0.0', '1.10.0']) {
  test(`compares numeric version components for ${version}`, async () => {
    const h = harness();
    h.release = release(version);
    h.start();
    await h.fire(10_000);
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0].detail, /1\.9\.0/);
    assert.match(h.notices[0].message, new RegExp(version.replace(/^v/, '').replaceAll('.', '\\.')));
  });
}

for (const version of ['v1.10', 'v1.10.0-beta.1', 'v1.10.0+build', 'v01.10.0', 'vv1.10.0', 'v9007199254740992.0.0', '../v2.0.0', 'v1.10.0\n', 'v1e2.0.0', 'v-1.10.0']) {
  test(`rejects invalid stable release version ${version}`, async () => {
    const h = harness();
    h.release = release(version);
    h.start();
    await h.fire(10_000);
    assert.equal(h.notices.length, 0);
    assert.equal(h.warnings.length, 1);
  });
}

test('rejects invalid installed version before scheduling', () => {
  const h = harness();
  assert.throws(() => h.start('1.9'), /Invalid AntiToken package version/);
  assert.equal(h.timers.size, 0);
});

for (const field of ['draft', 'prerelease']) {
  test(`ignores ${field} releases`, async () => {
    const h = harness();
    h.release[field] = true;
    h.start();
    await h.fire(10_000);
    assert.equal(h.notices.length, 0);
  });
}

test('ignores malformed release metadata', async () => {
  const h = harness();
  h.release = null;
  h.start();
  await h.fire(10_000);
  assert.equal(h.notices.length, 0);
  assert.equal(h.warnings.length, 1);
});

for (const [name, change] of [
  ['missing asset', r => { r.assets = []; }],
  ['upload in progress', r => { r.assets[0].state = 'open'; }],
  ['empty installer', r => { r.assets[0].size = 0; }],
  ['wrong installer name', r => { r.assets[0].name = 'other-setup.exe'; }],
  ['foreign host', r => { r.assets[0].browser_download_url = 'https://example.com/setup.exe'; }],
  ['insecure HTTP', r => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('https:', 'http:'); }],
  ['foreign repository', r => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('1yayaye/', 'other/'); }],
  ['local file URL', r => { r.assets[0].browser_download_url = 'file:///C:/setup.exe'; }],
]) {
  test(`rejects missing or untrusted installer: ${name}`, async () => {
    const h = harness();
    change(h.release);
    h.start();
    await h.fire(10_000);
    assert.equal(h.notices.length, 0);
    assert.equal(h.downloads.length, 0);
    assert.equal(h.warnings.length, 1);
  });
}

for (const status of [403, 404, 429, 500]) {
  test(`logs HTTP ${status} and retries on the next check`, async () => {
    const h = harness();
    h.status = status;
    h.start();
    await h.fire(10_000);
    assert.equal(h.notices.length, 0);
    assert.match(h.warnings[0], new RegExp(String(status)));
    h.status = 200;
    await h.fire(SIX_HOURS);
    assert.equal(h.notices.length, 1);
  });
}

test('logs network/JSON errors without stopping later checks', async () => {
  const h = harness();
  const goodFetch = h.fetch;
  h.fetch = async () => { throw new Error('offline'); };
  h.start();
  await h.fire(10_000);
  h.fetch = async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } });
  await h.fire(SIX_HOURS);
  assert.equal(h.notices.length, 0);
  assert.equal(h.warnings.length, 2);
  h.fetch = goodFetch;
  await h.fire(SIX_HOURS);
  assert.equal(h.notices.length, 1);
});

test('aborts after 15 seconds and prevents overlapping requests', async () => {
  const h = harness();
  h.fetch = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
  });
  h.start();
  const pending = h.fire(10_000);
  await h.fire(SIX_HOURS);
  assert.equal(h.requests.length, 1);
  await h.fire(15_000);
  await pending;
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.notices.length, 0);
  assert.equal(h.warnings.length, 1);
});

for (const choice of [1, -1]) {
  test(`Later/close/Esc never download (response ${choice})`, async () => {
    const h = harness();
    h.choice = choice;
    h.start();
    await h.fire(10_000);
    assert.equal(h.notices[0].cancelId, 1);
    assert.equal(h.notices[0].defaultId, 1);
    await h.fire(SIX_HOURS);
    assert.equal(h.notices.length, 1);
    assert.equal(h.downloads.length, 0);
  });
}

test('opens only the validated installer URL after Download', async () => {
  const h = harness();
  h.choice = 0;
  h.start();
  await h.fire(10_000);
  assert.deepEqual(h.downloads, [h.release.assets[0].browser_download_url]);
});

test('uses the preferred system language for the native prompt', async () => {
  const h = harness();
  h.languages = ['zh-CN', 'en-US'];
  h.start();
  await h.fire(10_000);
  assert.match(h.notices[0].message, /发现新版本 v1\.10\.0/);
  assert.equal(h.notices[0].buttons.join('/'), '下载更新/稍后');
});

test('waiting for the user has no network timeout and cannot open duplicate dialogs', async () => {
  const h = harness();
  let respond;
  h.electron.dialog.showMessageBox = options => {
    h.notices.push(options);
    return new Promise(resolve => { respond = resolve; });
  };
  h.start();
  const pending = h.fire(10_000);
  await new Promise(setImmediate);
  assert.equal(h.notices.length, 1);
  assert.equal([...h.timers.values()].some(timer => timer.ms === 15_000), false);
  await h.fire(SIX_HOURS);
  assert.equal(h.requests.length, 1);
  respond({ response: 1 });
  await pending;
});

test('reminds for a subsequent newer version and on a new process', async () => {
  const h = harness();
  h.start();
  await h.fire(10_000);
  h.release = release('v1.11.0');
  await h.fire(SIX_HOURS);
  assert.equal(h.notices.length, 2);
  const nextLaunch = harness();
  nextLaunch.start();
  await nextLaunch.fire(10_000);
  assert.equal(nextLaunch.notices.length, 1);
});

test('quit clears schedules and aborts an in-flight request', async () => {
  const h = harness();
  h.fetch = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  h.start();
  const pending = h.fire(10_000);
  h.electron.app.emit('will-quit');
  await pending;
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.warnings.length, 0);
});

test('quit cancels an open dialog and prevents a pending download', async () => {
  const h = harness();
  h.electron.dialog.showMessageBox = async options => {
    h.notices.push(options);
    h.electron.app.emit('will-quit');
    return { response: 0 };
  };
  h.start();
  await h.fire(10_000);
  assert.equal(h.notices[0].signal.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.downloads.length, 0);
});

test('multiple desktop windows and navigations start one checker through the loader', async () => {
  const h = harness();
  const app = h.electron.app;
  app.isReady = () => true;
  h.electron.ipcMain = { removeHandler() {}, handle() {} };
  const loader = { exports: {} };
  const contract = require('../src/injection-contract.cjs');
  const context = { ...h.context, module: loader, process: { env: {} }, __dirname: path.join(root, 'hosts/antigravity/scripts'),
    require: name => {
      if (name === 'electron') return h.electron;
      if (name === 'node:path') return path;
      if (name === 'node:os') return require('node:os');
      if (name === 'node:fs') return { existsSync: () => false, statSync: () => ({ mtimeMs: 1, size: 100 }), readFileSync: () => ' '.repeat(100) };
      if (name === './paths.cjs') return { getDevBundlePathFile: () => 'unused.path' };
      if (name.includes('aggregate-stats.cjs')) return {};
      if (name.includes('injection-contract.cjs')) return contract;
      if (name === './contract.json') return { version: '1.9.0' };
      if (name === './update-checker.cjs') return { startUpdateChecks: (_electron, version) => h.start(version) };
      throw new Error(`Unexpected require: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'hosts/antigravity/scripts/loader.cjs'), 'utf8'), context);
  const window = () => ({ getURL: () => 'http://127.0.0.1:1234/', executeJavaScript: async () => true });
  const a = window();
  const b = window();
  await Promise.all([loader.exports.injectStatsIntoWindow(a), loader.exports.injectStatsIntoWindow(b)]);
  await loader.exports.injectStatsIntoWindow(a);
  assert.equal([...h.timers.values()].filter(timer => timer.ms === 10_000).length, 1);
  assert.equal([...h.timers.values()].filter(timer => timer.ms === SIX_HOURS).length, 1);
  await h.fire(10_000);
  assert.equal(h.notices.length, 1);
});

test('release workflow accepts only a tag matching package.json', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const code = workflow.match(/- name: Validate release version[\s\S]*?run: node -e "([^"]+)"/)[1];
  const expected = `v${require('../package.json').version}`;
  execFileSync(process.execPath, ['-e', code], { cwd: root, env: { ...process.env, GITHUB_REF_NAME: expected } });
  assert.throws(() => execFileSync(process.execPath, ['-e', code], {
    cwd: root, env: { ...process.env, GITHUB_REF_NAME: 'v0.0.0' }, stdio: 'pipe',
  }), /Release tag must equal/);
});
