#!/usr/bin/env node
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.join(__dirname, '..');

function loadTsModule(filePath, mocks = {}) {
  const originalLoad = Module._load;
  const originalTsExt = require.extensions['.ts'];
  const originalTsxExt = require.extensions['.tsx'];

  const compile = (mod, filename) => {
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText;
    mod._compile(compiled, filename);
  };

  require.extensions['.ts'] = compile;
  require.extensions['.tsx'] = compile;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    return require(resolved);
  } finally {
    Module._load = originalLoad;
    require.extensions['.ts'] = originalTsExt;
    require.extensions['.tsx'] = originalTsxExt;
  }
}

function encodeVarint(num) {
  const bytes = [];
  let v = BigInt(num);
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function encodeFieldBytes(fieldNum, buf) {
  return Buffer.concat([encodeVarint((fieldNum << 3) | 2), encodeVarint(buf.length), buf]);
}

function encodeFieldVarint(fieldNum, value) {
  return Buffer.concat([encodeVarint((fieldNum << 3) | 0), encodeVarint(value)]);
}

// 1. DailyTrendCard: minimum window is last 7 days (< 7d displays as 7d)
{
  const reactStub = {
    memo: (c) => c,
    createContext: () => ({ Provider: () => null }),
    useContext: () => ({ t: (k) => k }),
    useLayoutEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
    useState: (init) => [init, () => {}],
  };
  const { selectTrendSeries } = loadTsModule(
    path.join(repoRoot, 'src', 'components', 'stats', 'DailyTrendCard.tsx'),
    {
      react: reactStub,
      [path.join(repoRoot, 'src', 'i18n', 'LanguageContext')]: { useLanguage: () => ({ t: (k) => k }) },
    }
  );

  const cells = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 1 + i));
    return {
      date: d.toISOString().slice(0, 10),
      month: 'Oct',
      dayOfWeek: d.getUTCDay(),
      tokens: (i + 1) * 1000,
      tasks: 1,
      level: 1,
    };
  });

  assert.equal(selectTrendSeries(cells, 'today').length, 7, 'today range must show 7 days');
  assert.equal(selectTrendSeries(cells, '1d').length, 7, '1d range must show 7 days');
  assert.equal(selectTrendSeries(cells, '7d').length, 7, '7d range must show 7 days');
  assert.equal(selectTrendSeries(cells, '30d').length, 30, '30d range must show 30 days');
  assert.equal(selectTrendSeries(cells, 'all').length, 40, 'all range must show all days');
  assert.equal(selectTrendSeries(cells.slice(0, 3), 'today').length, 7, 'fewer than 7 cells must be padded to minimum 7 days');
  assert.equal(selectTrendSeries(cells.slice(0, 1), 'today').length, 7, 'single cell must be padded to minimum 7 days');
  assert.equal(selectTrendSeries(cells.slice(0, 3), 'all').length, 7, 'all range with < 7 cells must show 7 days');
  assert.equal(selectTrendSeries([], 'today').length, 7, 'empty cells must return 7 days');
  assert.deepEqual(
    selectTrendSeries(cells, 'today').map(c => c.date),
    cells.slice(-7).map(c => c.date),
    '7-day window must select the most recent 7 calendar days ascending'
  );
  // Verify that the 3 provided cells maintain their token totals in the padded 7-day output
  const padded3 = selectTrendSeries(cells.slice(0, 3), 'today');
  assert.equal(padded3[6].tokens, cells[2].tokens, 'Latest day retains token count');
  assert.equal(padded3[5].tokens, cells[1].tokens, 'Second day retains token count');
  assert.equal(padded3[4].tokens, cells[0].tokens, 'First day retains token count');
  assert.equal(padded3[0].tokens, 0, 'Padded preceding days default to 0 tokens');
  console.log('PASS: DailyTrendCard enforces minimum 7-day window across ranges');
}

// 2. package.json unpatch script points to existing hosts/antigravity/scripts/unpatch-antigravity.cjs
{
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts && pkg.scripts.unpatch, 'package.json must contain unpatch script');
  assert.ok(
    pkg.scripts.unpatch.includes('hosts/antigravity/scripts/unpatch-antigravity.cjs'),
    'package.json unpatch must reference hosts/antigravity/scripts/unpatch-antigravity.cjs'
  );
  const targetRel = path.join('hosts', 'antigravity', 'scripts', 'unpatch-antigravity.cjs');
  assert.ok(fs.existsSync(path.join(repoRoot, targetRel)), 'Referenced unpatch script must exist on disk');
  console.log('PASS: package.json unpatch references existing unpatch script');
}

// 3. IDE quota-service protobuf OAuth token & userStatus tier parsing
{
  const { findTokenMessage, parseUserStatusTier } = loadTsModule(
    path.join(repoRoot, 'hosts', 'antigravity-ide', 'extension', 'src', 'quota-service.ts')
  );

  const epochSec = 1800000000;
  const tsMsg = encodeFieldVarint(1, epochSec);
  const tokenInner = Buffer.concat([
    encodeFieldBytes(1, Buffer.from('ya29.test-access-token', 'utf8')),
    encodeFieldBytes(3, Buffer.from('1//test-refresh-token', 'utf8')),
    encodeFieldBytes(4, tsMsg),
  ]);
  const wrapped = encodeFieldBytes(2, tokenInner);

  const direct = findTokenMessage(wrapped);
  assert.deepEqual(direct, {
    accessToken: 'ya29.test-access-token',
    refreshToken: '1//test-refresh-token',
    expiresAtMs: epochSec * 1000,
  }, 'Must decode nested protobuf OAuth token and Timestamp');

  const b64Layer = encodeFieldBytes(6, Buffer.from(wrapped.toString('base64'), 'utf8'));
  const decodedB64 = findTokenMessage(b64Layer);
  assert.deepEqual(decodedB64, direct, 'Must decode base64-wrapped protobuf OAuth token');

  const wrongPrefix = Buffer.concat([
    encodeFieldBytes(1, Buffer.from('invalid-access', 'utf8')),
    encodeFieldBytes(3, Buffer.from('invalid-refresh', 'utf8')),
  ]);
  assert.equal(findTokenMessage(wrongPrefix), null, 'Must ignore non-OAuth strings');
  assert.equal(findTokenMessage(new Uint8Array()), null, 'Must return null on empty buffer');

  // Synthetic antigravityUnifiedStateSync.userStatus sentinel envelope:
  // outer f1 -> f2 -> f1 (base64 UserStatus) where UserStatus has f7=email and f36=UserTier{f1=id,f2=name}
  const tierMsg = Buffer.concat([
    encodeFieldBytes(1, Buffer.from('g1-pro-tier', 'utf8')),
    encodeFieldBytes(2, Buffer.from('Google AI Pro', 'utf8')),
  ]);
  const userStatusMsg = Buffer.concat([
    encodeFieldBytes(7, Buffer.from('user@example.com', 'utf8')),
    encodeFieldBytes(36, tierMsg),
  ]);
  const entryMsg = encodeFieldBytes(1, Buffer.from(userStatusMsg.toString('base64'), 'utf8'));
  const sentinelMsg = Buffer.concat([
    encodeFieldBytes(1, Buffer.from('userStatusSentinelKey', 'utf8')),
    encodeFieldBytes(2, entryMsg),
  ]);
  const outer = encodeFieldBytes(1, sentinelMsg).toString('base64');
  const parsedTier = parseUserStatusTier(outer);
  assert.equal(parsedTier?.tier, 'pro', 'Must decode UserTier f36 from userStatus sentinel');
  assert.equal(parsedTier?.rawTierId, 'g1-pro-tier');
  assert.ok(parsedTier?.accountKey && !parsedTier.accountKey.includes('user@example.com'));
  assert.equal(parseUserStatusTier(''), null);
  console.log('PASS: IDE quota-service protobuf OAuth token & userStatus tier decoder');
}

// 4. IDE extension CSPRNG getNonce & .db-wal/.db-shm session tracking
{
  const vscodeStub = {
    window: {
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
      activeColorTheme: { kind: 2 },
    },
    StatusBarAlignment: { Right: 2 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrastLight: 4 },
    MarkdownString: class { appendMarkdown() {} },
    ThemeColor: class {},
  };
  const { getNonce, extractSessionIdFromConvFile } = loadTsModule(
    path.join(repoRoot, 'hosts', 'antigravity-ide', 'extension', 'src', 'extension.ts'),
    { vscode: vscodeStub }
  );

  const n1 = getNonce();
  const n2 = getNonce();
  assert.match(n1, /^[0-9a-f]{32}$/, 'getNonce must return a 32-char hex CSPRNG nonce');
  assert.notEqual(n1, n2, 'Subsequent getNonce calls must differ');

  assert.equal(extractSessionIdFromConvFile('abc-123.db'), 'abc-123');
  assert.equal(extractSessionIdFromConvFile('abc-123.db-wal'), 'abc-123');
  assert.equal(extractSessionIdFromConvFile('abc-123.db-shm'), 'abc-123');
  assert.equal(extractSessionIdFromConvFile('notes.txt'), null);
  console.log('PASS: IDE extension getNonce uses CSPRNG and .db-wal/.db-shm maps to sessionId');
}

// 5. proxy-manager nonBlocking mode avoids synchronous tasklist.exe calls
{
  const pmPath = require.resolve('./proxy-manager.cjs');
  delete require.cache[pmPath];
  const origExecFileSync = childProcess.execFileSync;
  const origExecFile = childProcess.execFile;
  let syncCalls = 0;
  let asyncCalls = 0;

  childProcess.execFileSync = (cmd, ...rest) => {
    if (String(cmd).toLowerCase() === 'tasklist') syncCalls++;
    return origExecFileSync.call(childProcess, cmd, ...rest);
  };
  childProcess.execFile = (cmd, args, opts, cb) => {
    if (String(cmd).toLowerCase() === 'tasklist') {
      asyncCalls++;
      if (typeof opts === 'function') opts(null, '', '');
      else if (typeof cb === 'function') cb(null, '', '');
      return { on() {} };
    }
    return origExecFile.call(childProcess, cmd, args, opts, cb);
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-pm-test-'));
  try {
    const pm = require(pmPath);
    const status = pm.getTargetStatus('desktop', tmpDir, { nonBlocking: true });
    assert.equal(status.isRunning, false);
    const allStatus = pm.getAllStatus({ nonBlocking: true });
    assert.ok(allStatus && 'desktop' in allStatus && 'ide' in allStatus);
    assert.equal(syncCalls, 0, 'nonBlocking status check must never spawn synchronous tasklist.exe');
    if (process.platform === 'win32') {
      assert.ok(asyncCalls >= 1, 'nonBlocking check should schedule async tasklist refresh');
    }
    console.log('PASS: proxy-manager nonBlocking avoids sync tasklist.exe');
  } finally {
    childProcess.execFileSync = origExecFileSync;
    childProcess.execFile = origExecFile;
    delete require.cache[pmPath];
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// 6. aggregate-stats CLI entrypoint prints valid JSON and exits 0
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-cli-test-'));
  try {
    const res = childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'aggregate-stats.cjs')], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ANTIGRAVITY_DATA_DIR: tmpDir, ANTIGRAVITY_DISABLE_PERSIST_CACHE: '1' },
    });
    assert.equal(res.status, 0, `aggregate-stats CLI exited with ${res.status}: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.kpis && parsed.activity && parsed.meta, 'CLI output must contain kpis, activity, and meta');
    console.log('PASS: aggregate-stats.cjs CLI outputs JSON metrics cleanly');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// 7. loader.cjs throttles unthrottled full-scan IPC_REQUEST_SYNC requests
{
  const loaderSrc = fs.readFileSync(path.join(repoRoot, 'hosts', 'antigravity', 'scripts', 'loader.cjs'), 'utf8');
  assert.ok(
    loaderSrc.includes('Date.now() - lastFullScanAt >= FULL_SCAN_MIN_GAP_MS'),
    'loader IPC_REQUEST_SYNC must throttle full scans via FULL_SCAN_MIN_GAP_MS'
  );
  console.log('PASS: loader.cjs IPC_REQUEST_SYNC full-scan throttling guard verified');
}

// 8. standalone.tsx restores sibling host panels inside panelsContainer when switching back from Usage Stats
{
  const savedWindow = global.window;
  const savedDocument = global.document;
  const savedMutationObserver = global.MutationObserver;
  const savedLocalStorage = global.localStorage;
  const savedNavigator = global.navigator;
  const savedCssHook = require.extensions['.css'];

  const createMockElement = (tagName = 'div') => {
    const listeners = {};
    const attrs = {};
    const classSet = new Set();
    const el = {
      tagName: tagName.toUpperCase(),
      id: '',
      className: '',
      innerText: '',
      textContent: '',
      innerHTML: '',
      offsetWidth: 0,
      style: {},
      children: [],
      parentElement: null,
      previousElementSibling: null,
      get firstElementChild() {
        return el.children[0] || null;
      },
      classList: {
        add: (...names) => names.forEach((n) => classSet.add(n)),
        remove: (...names) => names.forEach((n) => classSet.delete(n)),
        contains: (n) => classSet.has(n),
      },
      setAttribute: (k, v) => {
        attrs[k] = String(v);
        if (k === 'id') el.id = String(v);
      },
      getAttribute: (k) => (k === 'id' ? el.id || null : (k in attrs ? attrs[k] : null)),
      removeAttribute: (k) => {
        delete attrs[k];
      },
      appendChild: (child) => {
        child.parentElement = el;
        const prev = el.children[el.children.length - 1] || null;
        child.previousElementSibling = prev;
        el.children.push(child);
        return child;
      },
      after: (sibling) => {
        if (!el.parentElement) return;
        const siblings = el.parentElement.children;
        const idx = siblings.indexOf(el);
        sibling.parentElement = el.parentElement;
        if (idx >= 0) {
          siblings.splice(idx + 1, 0, sibling);
        } else {
          siblings.push(sibling);
        }
      },
      contains: (target) => {
        if (target === el) return true;
        return el.children.some((c) => c.contains(target));
      },
      addEventListener: (type, fn) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(fn);
      },
      removeEventListener: (type, fn) => {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((f) => f !== fn);
      },
      trigger: (type, event = {}) => {
        const evt = { preventDefault() {}, stopPropagation() {}, ...event };
        (listeners[type] || []).forEach((fn) => fn(evt));
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    return el;
  };

  try {
    delete global.window;
    require.extensions['.css'] = () => {};

    const modal = createMockElement('div');
    modal.className = 'settings-modal-container';
    const splitContainer = createMockElement('div');
    splitContainer.offsetWidth = 900;
    const leftNav = createMockElement('div');
    leftNav.offsetWidth = 220;
    const rightContentPanel = createMockElement('div');
    rightContentPanel.offsetWidth = 680;

    const modelsBtn = createMockElement('button');
    modelsBtn.innerText = 'Models';
    const editorBtn = createMockElement('button');
    editorBtn.innerText = 'Editor';
    leftNav.appendChild(modelsBtn);
    leftNav.appendChild(editorBtn);

    const viewport = createMockElement('div');
    const panelsContainer = createMockElement('div');
    const hostPanelModels = createMockElement('div');
    const hostPanelEditor = createMockElement('div');
    panelsContainer.appendChild(hostPanelModels);
    panelsContainer.appendChild(hostPanelEditor);
    viewport.appendChild(panelsContainer);

    const overlayScrollbar = createMockElement('div');
    rightContentPanel.appendChild(viewport);
    rightContentPanel.appendChild(overlayScrollbar);
    rightContentPanel.querySelector = (sel) => (sel === '[data-testid="overlay-scrollbar"]' ? overlayScrollbar : null);

    splitContainer.appendChild(leftNav);
    splitContainer.appendChild(rightContentPanel);
    modal.appendChild(splitContainer);
    modal.querySelectorAll = (sel) => {
      if (sel === 'button') return leftNav.children.filter((c) => c.tagName === 'BUTTON');
      return [];
    };

    const body = createMockElement('body');
    body.appendChild(modal);

    const findById = (root, id) => {
      if (root.id === id) return root;
      for (const child of root.children) {
        const hit = findById(child, id);
        if (hit) return hit;
      }
      return null;
    };

    global.document = {
      head: createMockElement('head'),
      body,
      documentElement: createMockElement('html'),
      createElement: (tag) => createMockElement(tag),
      getElementById: (id) => findById(body, id) || findById(global.document.head, id),
      querySelector: (sel) => (sel === '.settings-modal-container' ? modal : null),
      querySelectorAll: () => [],
    };
    global.MutationObserver = class {
      observe() {}
      disconnect() {}
      takeRecords() { return []; }
    };
    global.localStorage = { getItem: () => null, setItem: () => {} };
    global.navigator = { language: 'en-US' };

    const standaloneMod = loadTsModule(path.join(repoRoot, 'hosts', 'antigravity', 'src', 'standalone.tsx'), {
      '../../../src/index.css': {},
      './i18n/antigravity-ui-i18n': {
        antigravityI18n: {
          translateSubtree: () => {},
          startObserver: () => {},
          stopObserver: () => {},
          getLanguage: () => 'en',
          setLanguage: () => {},
        },
      },
      './quota': { startQuotaUpdates: () => {} },
      '../../../src/components/stats/StatsView': { StatsView: () => null },
      '../../../src/components/dsh/DshStatusBar': { DshStatusBar: () => null },
      '../../../src/services/stats-service': {
        detectAntigravityTheme: () => ({ mode: 'dark' }),
        syncThemeToElement: () => {},
      },
      'react': { createElement: () => ({}), Fragment: 'Fragment' },
      'react-dom/client': {
        createRoot: () => ({
          render: () => {},
          unmount: () => {},
        }),
      },
    });

    global.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
      getComputedStyle: () => ({ backgroundColor: 'rgb(30, 30, 30)', color: 'rgb(200, 200, 200)' }),
    };

    standaloneMod.initAntigravitySettingsInjector();

    const statsBtn = global.document.getElementById('antigravity-stats-nav-btn');
    assert.ok(statsBtn, 'Usage Stats nav button must be injected after Models');

    statsBtn.trigger('click');
    const statsContainer = global.document.getElementById('antigravity-stats-settings-content');
    assert.ok(statsContainer, 'Clicking Usage Stats must mount stats container');
    assert.strictEqual(statsContainer.parentElement, panelsContainer, 'Stats container must mount inside panelsContainer');
    assert.strictEqual(hostPanelModels.style.display, 'none', 'Sibling host panel 1 must be hidden when Usage Stats is open');
    assert.strictEqual(hostPanelEditor.style.display, 'none', 'Sibling host panel 2 must be hidden when Usage Stats is open');

    modelsBtn.trigger('click');
    assert.strictEqual(statsContainer.style.display, 'none', 'Clicking Models must hide Usage Stats container');
    assert.strictEqual(hostPanelModels.style.display, '', 'Clicking Models must restore sibling host panel 1 display');
    assert.strictEqual(hostPanelEditor.style.display, '', 'Clicking Models must restore sibling host panel 2 display');
    assert.strictEqual(rightContentPanel.style.display, '', 'Clicking Models must keep rightContentPanel visible');

    console.log('PASS: standalone.tsx restores sibling host panels when switching back from Usage Stats');
  } finally {
    if (savedWindow === undefined) delete global.window; else global.window = savedWindow;
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
    if (savedMutationObserver === undefined) delete global.MutationObserver; else global.MutationObserver = savedMutationObserver;
    if (savedLocalStorage === undefined) delete global.localStorage; else global.localStorage = savedLocalStorage;
    if (savedNavigator === undefined) delete global.navigator; else global.navigator = savedNavigator;
    if (savedCssHook === undefined) delete require.extensions['.css']; else require.extensions['.css'] = savedCssHook;
  }
}
