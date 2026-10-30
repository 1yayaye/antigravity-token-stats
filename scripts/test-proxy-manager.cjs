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
  assert.strictEqual(defaultConfig.proxy_rules.routing.default_action, 'proxy');
  assert.strictEqual(defaultConfig.proxy_rules.dns_mode, 'direct');
  assert.strictEqual(defaultConfig.updates?.enabled, false);
  assert.strictEqual(defaultConfig.ui?.load_notify, 'once');
  console.log('PASS: default config.json matches upstream v2.4 requirements');

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

    // Update config (change port) without touching version.dll
    const updateRes = proxyManager.installProxy('desktop', { dir: tmpDir, port: 9999, type: 'socks5', skipProcessCheck: true });
    assert.strictEqual(updateRes.success, true);
    const updatedStatus = proxyManager.getTargetStatus('desktop', tmpDir);
    assert.strictEqual(updatedStatus.config.proxy.port, 9999);
    console.log('PASS: installProxy updates config.json seamlessly when version.dll is already up-to-date');

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
  } finally {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  }
}

// 6. Proxy Connectivity Fallback Test
console.log('\n--- Testing Proxy Connectivity Error Handling ---');
(async () => {
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

  console.log('\n============================================================');
  console.log('ALL Proxy Manager tests passed successfully!');
  console.log('============================================================\n');
})();
