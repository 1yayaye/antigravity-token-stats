#!/usr/bin/env node
/**
 * Test Suite for Antigravity Proxy Manager & Diagnostics
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const proxyManager = require('./proxy-manager.cjs');

console.log('============================================================');
console.log('Antigravity Proxy Manager & Diagnostics — Test Suite');
console.log('============================================================\n');

// 1. Config Building Tests
console.log('--- Testing Config Generator ---');
{
  const defaultConfig = proxyManager.buildConfig();
  assert.strictEqual(defaultConfig.proxy.type, 'socks5');
  assert.strictEqual(defaultConfig.proxy.port, 7890);
  assert.strictEqual(defaultConfig.proxy.host, '127.0.0.1');
  assert.strictEqual(defaultConfig.child_injection, true);
  assert.strictEqual(defaultConfig.child_injection_mode, 'filtered');
  assert.ok(defaultConfig.target_processes.includes('Antigravity.exe'));
  assert.ok(defaultConfig.target_processes.includes('Antigravity IDE.exe'));
  assert.ok(defaultConfig.target_processes.includes('node.exe'));
  assert.ok(defaultConfig.target_processes.includes('language_server_windows_x64.exe'));
  assert.strictEqual(defaultConfig._version, '2.6.3');
  assert.strictEqual(defaultConfig.diagnostics?.agent_ip_probe, false);
  assert.strictEqual(defaultConfig.proxy_rules.routing.default_action, 'proxy');
  assert.strictEqual(defaultConfig.proxy_rules.dns_mode, 'direct');
  assert.strictEqual(defaultConfig.updates?.enabled, false);
  assert.strictEqual(defaultConfig.ui?.load_notify, 'none');
  const templatePath = path.join(__dirname, '..', 'vendor', 'proxy', 'win-x64', 'config.template.json');
  const templateJson = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  assert.strictEqual(templateJson._version, '2.6.3', 'config.template.json must align with v2.6.3');
  assert.strictEqual(templateJson.diagnostics?.agent_ip_probe, false, 'config.template.json must disable agent_ip_probe by default');
  assert.strictEqual(templateJson.ui?.load_notify, 'none', 'config.template.json must suppress startup load popup');
  console.log('PASS: default config.json disables load_notify popup and matches v2.6.3 schema');

  assert.throws(() => proxyManager.getTargetStatus('unknown_target'), /Unknown target/);
  assert.throws(() => proxyManager.installProxy('unknown_target'), /Unknown target/);
  assert.throws(() => proxyManager.uninstallProxy('unknown_target'), /Unknown target/);
  console.log('PASS: invalid target names rejected with clear validation error');

  const customConfig = proxyManager.buildConfig({
    type: 'http',
    port: 10809,
    host: '192.168.1.10',
    logLevel: 'debug',
  });
  assert.strictEqual(customConfig.proxy.type, 'http');
  assert.strictEqual(customConfig.proxy.port, 10809);
  assert.strictEqual(customConfig.proxy.host, '192.168.1.10');
  assert.strictEqual(customConfig.log_level, 'debug');
  console.log('PASS: custom config parameters applied correctly');
}

// 2. Status Inspection Tests
console.log('\n--- Testing Status Detection ---');
{
  const allStatus = proxyManager.getAllStatus();
  assert.ok('desktop' in allStatus);
  assert.ok('ide' in allStatus);
  assert.strictEqual(typeof allStatus.desktop.installed, 'boolean');
  assert.strictEqual(typeof allStatus.ide.installed, 'boolean');
  assert.strictEqual(typeof allStatus.desktop.isRunning, 'boolean');
  assert.strictEqual(typeof allStatus.ide.isRunning, 'boolean');
  console.log('PASS: target status discovery returns well-formed Desktop and IDE metadata');
}

// 3. Vendor Binary Integrity Tests
console.log('\n--- Testing Vendor Binary Integrity ---');
{
  const vendorDll = proxyManager.getVendorDllPath();
  assert.ok(vendorDll, 'vendor version.dll path must resolve');
  assert.ok(fs.existsSync(vendorDll), 'vendor version.dll file must exist');
  const stat = fs.statSync(vendorDll);
  assert.ok(stat.size > 500000, `version.dll size (${stat.size}) should be > 500KB`);
  console.log(`PASS: verified vendor version.dll exists (${(stat.size / 1024).toFixed(1)} KB)`);
}

// 4. Sandbox Lifecycle Tests (Mock install and uninstall)
console.log('\n--- Testing Mock Installation & Uninstallation Lifecycle ---');
{
  const tmpDir = path.join(os.tmpdir(), `ag-proxy-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Create mock Antigravity executable in temp directory
    fs.writeFileSync(path.join(tmpDir, 'Antigravity.exe'), 'mock-exe');

    // 1. Install
    const installRes = proxyManager.installProxy('desktop', { dir: tmpDir, port: 8888, type: 'socks5', skipProcessCheck: true });
    assert.strictEqual(installRes.success, true);
    assert.ok(fs.existsSync(path.join(tmpDir, 'version.dll')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'config.json')));

    const writtenConfig = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
    assert.strictEqual(writtenConfig.proxy.port, 8888);
    console.log('PASS: installProxy successfully copies version.dll and generates valid config.json');

    // Check status
    const status = proxyManager.getTargetStatus('desktop', tmpDir);
    assert.strictEqual(status.installed, true);
    assert.strictEqual(status.config.proxy.port, 8888);
    console.log('PASS: getTargetStatus reports installed: true with active config');

    // Update config (change port) without touching version.dll or custom fields
    const cfgPath = path.join(tmpDir, 'config.json');
    const existingCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    existingCfg.log_level = 'debug';
    existingCfg.proxy_rules.routing.rules = [{ name: 'custom-direct', action: 'direct', domains: ['internal.example'] }];
    fs.writeFileSync(cfgPath, `// user comment\n${JSON.stringify(existingCfg, null, 2)}`, 'utf8');

    const updateRes = proxyManager.installProxy('desktop', { dir: tmpDir, port: 9999, type: 'socks5', skipProcessCheck: true });
    assert.strictEqual(updateRes.success, true);
    const updatedStatus = proxyManager.getTargetStatus('desktop', tmpDir);
    assert.strictEqual(updatedStatus.config.proxy.port, 9999);
    assert.strictEqual(updatedStatus.config.log_level, 'debug', 'installProxy must preserve existing log_level');
    assert.strictEqual(
      updatedStatus.config.proxy_rules?.routing?.rules?.[0]?.name,
      'custom-direct',
      'installProxy must preserve existing custom routing rules'
    );
    console.log('PASS: installProxy preserves custom config.json settings when updating proxy endpoint');

    // 2. Uninstall
    const uninstallRes = proxyManager.uninstallProxy('desktop', { dir: tmpDir, skipProcessCheck: true });
    assert.strictEqual(uninstallRes.success, true);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'version.dll')), false);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'config.json')), false);
    console.log('PASS: uninstallProxy removes version.dll and config.json cleanly');

    const afterStatus = proxyManager.getTargetStatus('desktop', tmpDir);
    assert.strictEqual(afterStatus.installed, false);
    console.log('PASS: getTargetStatus reports installed: false after removal');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 5. Log Diagnostics & Location Error Detection Tests
console.log('\n--- Testing Log Location Error Scanner ---');
{
  const tmpLogDir = path.join(os.tmpdir(), `ag-log-test-${Date.now()}`);
  const runDir = path.join(tmpLogDir, '2026-10-28T090000');
  fs.mkdirSync(runDir, { recursive: true });

  try {
    // 1. Normal log (no error)
    fs.writeFileSync(path.join(runDir, 'ls-main.log'), '2026-10-28 info language server starting\n');
    let errors = proxyManager.scanLogForLocationErrors(tmpLogDir);
    assert.strictEqual(errors.length, 0);
    console.log('PASS: clean log returns zero location restriction errors');

    // 2. Error log with location restriction
    fs.appendFileSync(
      path.join(runDir, 'ls-main.log'),
      'agent executor error: FAILED_PRECONDITION (code 400): User location is not supported for the API use.\n'
    );
    errors = proxyManager.scanLogForLocationErrors(tmpLogDir);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].timestamp, '2026-10-28T090000');
    assert.ok(errors[0].error.includes('User location is not supported'));
    console.log('PASS: scanner accurately flags "User location is not supported for the API use"');

    // 3. Newer successful login supersedes older location error
    const newerRunDir = path.join(tmpLogDir, '2026-10-29T090000');
    fs.mkdirSync(newerRunDir, { recursive: true });
    const cloudCodeLog = path.join(newerRunDir, 'cloudcode.log');
    fs.writeFileSync(cloudCodeLog, 'CredentialStorage: ProjectId updated for user@example.com\n', 'utf8');
    const futureTime = new Date(Date.now() + 5000);
    fs.utimesSync(cloudCodeLog, futureTime, futureTime);
    errors = proxyManager.scanLogForLocationErrors(tmpLogDir);
    assert.strictEqual(errors.length, 0, 'newer login evidence must supersede historical location error');
    console.log('PASS: scanner ignores stale historical location error superseded by newer login evidence');
  } finally {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  }
}

// 6. Proxy Connectivity Fallback & Protocol Mismatch Tests
console.log('\n--- Testing Proxy Connectivity Error Handling & Protocol Mismatch ---');
(async () => {
  const net = require('node:net');

  // Test connection to an unreachable local port
  const res = await proxyManager.testProxy({
    host: '127.0.0.1',
    port: 59998,
    type: 'socks5',
    timeoutMs: 500,
  });
  assert.strictEqual(res.ok, false);
  assert.ok(typeof res.error === 'string');
  console.log('PASS: testProxy handles unreachable endpoints gracefully with clear error description');

  // Mock HTTP proxy probed as SOCKS5 -> must detect protocol mismatch
  const mockHttp = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', () => {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.end();
    });
  });
  await new Promise((resolve) => mockHttp.listen(0, '127.0.0.1', resolve));
  try {
    const mismatchRes = await proxyManager.testProxy({
      host: '127.0.0.1',
      port: mockHttp.address().port,
      type: 'socks5',
      timeoutMs: 1500,
    });
    assert.strictEqual(mismatchRes.ok, false);
    assert.strictEqual(mismatchRes.stage, 'handshake');
    assert.ok(/HTTP/i.test(mismatchRes.error), `Expected HTTP mismatch hint, got: ${mismatchRes.error}`);
    console.log('PASS: testProxy detects HTTP proxy misconfigured as SOCKS5');
  } finally {
    mockHttp.close();
  }

  // Mock SOCKS5 proxy probed as HTTP -> must detect protocol mismatch
  const mockSocks = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', () => {
      socket.write(Buffer.from([0x05, 0xff]));
      socket.end();
    });
  });
  await new Promise((resolve) => mockSocks.listen(0, '127.0.0.1', resolve));
  try {
    const mismatchRes = await proxyManager.testProxy({
      host: '127.0.0.1',
      port: mockSocks.address().port,
      type: 'http',
      timeoutMs: 1500,
    });
    assert.strictEqual(mismatchRes.ok, false);
    assert.strictEqual(mismatchRes.stage, 'handshake');
    assert.ok(/SOCKS5/i.test(mismatchRes.error), `Expected SOCKS5 mismatch hint, got: ${mismatchRes.error}`);
    console.log('PASS: testProxy detects SOCKS5 proxy misconfigured as HTTP');
  } finally {
    mockSocks.close();
  }

  // Runtime DLL check must not match System32\version.dll or non-existent paths
  const fakeDllLoaded = proxyManager.isDllLoadedInProcess(path.join(os.tmpdir(), 'nonexistent-antigravity', 'version.dll'));
  assert.notStrictEqual(fakeDllLoaded, true, 'isDllLoadedInProcess must not report true for non-loaded target path');
  console.log('PASS: isDllLoadedInProcess distinguishes target path from System32 version.dll');

  // 7. Log Directory Resolution & Panel Card Rendering
  console.log('\n--- Testing Proxy Log Directory & ProxyStatusCard Rendering ---');
  const tmpAppDir = path.join(os.tmpdir(), `ag-proxy-log-app-${Date.now()}`);
  const appLogsDir = path.join(tmpAppDir, 'logs');
  fs.mkdirSync(appLogsDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(appLogsDir, 'proxy.log'), 'init\n', 'utf8');
    assert.strictEqual(proxyManager.resolveProxyLogDir(tmpAppDir, true), appLogsDir);
    console.log('PASS: resolveProxyLogDir prefers app logs dir when proxy.log is present');
  } finally {
    fs.rmSync(tmpAppDir, { recursive: true, force: true });
  }

  const ts = require('typescript');
  const React = require('react');
  const ReactDOMServer = require('react-dom/server');
  const origTsExt = require.extensions['.ts'];
  const origTsxExt = require.extensions['.tsx'];
  require.extensions['.ts'] = (mod, filename) => {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    mod._compile(out, filename);
  };
  require.extensions['.tsx'] = (mod, filename) => {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    mod._compile(out, filename);
  };
  try {
    const { LanguageProvider } = require('../src/i18n/LanguageContext.tsx');
    const { ProxyStatusCard } = require('../src/components/stats/ProxyStatusCard.tsx');
    const sampleLogDir = 'C:\\Users\\demo\\AppData\\Local\\Temp\\antigravity-proxy-logs';
    const renderCard = (proxy) => ReactDOMServer.renderToStaticMarkup(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(ProxyStatusCard, { proxy })
      )
    );

    const html = renderCard({
      pluginVersion: '1.8.2',
      desktop: {
        target: 'desktop',
        installed: true,
        available: true,
        dir: 'C:\\Antigravity',
        isRunning: true,
        dllExists: true,
        configExists: true,
        dllLoaded: true,
        config: { proxy: { type: 'socks5', host: '127.0.0.1', port: 7890 } },
      },
      ide: { target: 'ide', installed: false, available: false, dir: null, isRunning: false, dllExists: false, configExists: false },
      logDir: sampleLogDir,
    });
    assert.ok(!html.includes('MinHook'), 'ProxyStatusCard must not render MinHook badge');
    assert.ok(!html.includes('免 TUN') && !html.includes('No TUN'), 'ProxyStatusCard must not render TUN wording');
    assert.ok(!html.includes('>IDE<'), 'Desktop ProxyStatusCard must not render IDE status tag');
    assert.ok(html.includes('v1.8.2'), 'ProxyStatusCard must render plugin version');
    assert.ok(html.includes(sampleLogDir), 'ProxyStatusCard must render proxy log directory in panel');
    assert.ok(html.includes('Active') || html.includes('已启用'), 'ProxyStatusCard must render Active status when loaded');

    const pendingHtml = renderCard({
      desktop: { target: 'desktop', installed: true, available: true, dir: 'C:\\Antigravity', isRunning: true, dllExists: true, configExists: true, dllLoaded: false },
      ide: { target: 'ide', installed: false, available: false, dir: null, isRunning: false, dllExists: false, configExists: false },
    });
    assert.ok(pendingHtml.includes('Restart required') || pendingHtml.includes('待重启生效'),
      'ProxyStatusCard must render Restart required when dllLoaded === false');

    const wipedHtml = renderCard({
      desktop: { target: 'desktop', installed: false, available: true, dir: 'C:\\Antigravity', isRunning: true, dllExists: false, configExists: true, dllLoaded: false },
      ide: { target: 'ide', installed: false, available: false, dir: null, isRunning: false, dllExists: false, configExists: false },
    });
    assert.ok(wipedHtml.includes('DLL missing') || wipedHtml.includes('DLL 缺失'),
      'ProxyStatusCard must flag DLL missing even while host process is running');

    const inactiveHtml = renderCard({
      desktop: { target: 'desktop', installed: false, available: true, dir: 'C:\\Antigravity', isRunning: true, dllExists: false, configExists: false, dllLoaded: null },
      ide: { target: 'ide', installed: false, available: false, dir: null, isRunning: false, dllExists: false, configExists: false },
    });
    assert.ok(inactiveHtml.includes('Inactive') || inactiveHtml.includes('未启用'),
      'ProxyStatusCard must show Inactive when proxy is not installed even if Antigravity is running');

    console.log('PASS: ProxyStatusCard renders accurate desktop proxy states, hides IDE, shows plugin version, and supports log actions');
  } finally {
    require.extensions['.ts'] = origTsExt;
    require.extensions['.tsx'] = origTsxExt;
  }

  console.log('\n============================================================');
  console.log('ALL Proxy Manager tests passed successfully!');
  console.log('============================================================\n');
})();
