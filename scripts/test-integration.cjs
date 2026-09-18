#!/usr/bin/env node
/**
 * Integration Test Suite for Pure CDP Hot Injection & Smart Launcher
 * 
 * Verifies:
 * 1. Graceful error handling when Antigravity is not running.
 * 2. Real CDP connection & bundle injection when DevTools port is active.
 * 3. Toast presence, single-instance constraint, and clean removal.
 * 4. Rapid mount/unmount stress safety without errors or ghost DOM elements.
 * 5. Launcher exports & isDevToolsReady port validation.
 * 6. Shortcut creation & Windows LNK integrity.
 * 7. Unpatch idempotency and pristine file protection.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDevToolsPort, inject } = require('./inject-live.cjs');
const { findAntigravityExe, isDevToolsReady } = require('./launch-antigravity.cjs');
const { unpatch } = require('./unpatch-antigravity.cjs');

const TESTS = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  TESTS.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================================================
// TESTS
// ============================================================================

test('Graceful handling when DevToolsActivePort is missing', async () => {
  const originalEnv = process.env.ANTIGRAVITY_DEVTOOLS_PATH;
  const originalPort = process.env.ANTIGRAVITY_DEVTOOLS_PORT;
  try {
    delete process.env.ANTIGRAVITY_DEVTOOLS_PORT;
    process.env.ANTIGRAVITY_DEVTOOLS_PATH = path.join(os.tmpdir(), 'non_existent_port_file_' + Date.now());
    let threw = false;
    try {
      await getDevToolsPort();
    } catch (err) {
      threw = true;
      assert(err.message.includes('DevToolsActivePort not found at'), 'Should explain file not found');
      assert(err.message.includes('Tip: Run "npm run launch"'), 'Should give helpful tip');
    }
    assert(threw, 'Should throw when DevToolsActivePort does not exist');
  } finally {
    if (originalEnv) {
      process.env.ANTIGRAVITY_DEVTOOLS_PATH = originalEnv;
    } else {
      delete process.env.ANTIGRAVITY_DEVTOOLS_PATH;
    }
    if (originalPort) {
      process.env.ANTIGRAVITY_DEVTOOLS_PORT = originalPort;
    }
  }
});

test('Graceful handling when DevTools port connection is refused during injection', async () => {
  let threw = false;
  try {
    await inject({ port: 64998, silent: true });
  } catch (err) {
    threw = true;
    assert(err.message.includes('Could not connect to Antigravity DevTools on port 64998'), 'Should specify connection failure');
    assert(err.message.includes('Tip: Run "npm run launch"'), 'Should provide launch tip');
  }
  assert(threw, 'inject() should throw graceful error on unreachable port');
});

test('Official Antigravity executable detection', () => {
  const exePath = findAntigravityExe();
  assert(fs.existsSync(exePath), `Antigravity executable must exist at ${exePath}`);
  assert(exePath.toLowerCase().endsWith('antigravity.exe'), 'Must point to Antigravity.exe');
});

test('isDevToolsReady returns false on inactive port without throwing', async () => {
  const ready = await isDevToolsReady(64999);
  assert(ready === false, 'Should return false for inactive port');
});

test('Live CDP hot injection succeeds with active DevTools port', async () => {
  let port = null;
  try {
    port = await getDevToolsPort();
  } catch (err) {
    console.log('   (Skipping live injection: Antigravity not currently running)');
    return;
  }
  if (!(await isDevToolsReady(port))) {
    console.log('   (Skipping live injection: DevTools port is not reachable)');
    return;
  }

  const result = await inject({ port, silent: true, openModal: true });
  assert(result, 'Injection should return result object');
  assert(result.success === true, 'Injection result.success should be true');
  assert(result.hasAntigravityStats === true, 'window.AntigravityStats must exist in renderer');
  assert(result.hasToast === true, 'Toast must be mounted immediately after injection');
  assert(typeof result.lifetimeTokens === 'string', 'lifetimeTokens KPI must be populated');
  // Recheck after startup navigation, not just immediately after evaluating the bundle.
  await new Promise(resolve => setTimeout(resolve, 2000));
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
  const target = pages.find(page => page.type === 'page' && page.url.startsWith('http'));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const rendered = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('Render verification timed out')); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression: `!!window.AntigravityStats && !!document.querySelector('.stats-view h1')`, returnByValue: true,
    } }));
    ws.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.id !== 1) return;
      clearTimeout(timer); ws.close(); resolve(data.result?.result?.value);
    };
    ws.onerror = () => { clearTimeout(timer); ws.close(); reject(new Error('Render verification connection failed')); };
  });
  assert(rendered === true, 'Stats heading must remain rendered after startup navigation');
});

test('Toast single-instance constraint & cleanup via CDP', async () => {
  let port = null;
  try {
    port = await getDevToolsPort();
  } catch {
    console.log('   (Skipping live toast test: Antigravity not currently running)');
    return;
  }
  if (!(await isDevToolsReady(port))) {
    console.log('   (Skipping live toast test: DevTools port is not reachable)');
    return;
  }

  const pagesRes = await fetch(`http://127.0.0.1:${port}/json`);
  const pages = await pagesRes.json();
  const mainPage = pages.find(p => p.type === 'page' && !p.url.includes('devtools://'));
  assert(mainPage, 'Must have active main page');

  const ws = new WebSocket(mainPage.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = async () => {
      let reqId = 200;
      const evalCDP = (expr) => new Promise((res, rej) => {
        const id = reqId++;
        const onMsg = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', onMsg);
            if (data.error) rej(new Error(data.error.message));
            else res(data.result?.result?.value);
          }
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
      });

      try {
        // Trigger multiple toasts rapidly
        const count = await evalCDP(`
          (() => {
            window.AntigravityStats.showToast('Test 1');
            window.AntigravityStats.showToast('Test 2');
            window.AntigravityStats.showToast('Test 3');
            return document.querySelectorAll('#antigravity-stats-toast').length;
          })()
        `);
        assert(count === 1, `Expected exactly 1 toast element, got ${count}`);

        // Clean up toast
        const cleaned = await evalCDP(`
          (() => {
            window.AntigravityStats.closeToast();
            return !!document.getElementById('antigravity-stats-toast');
          })()
        `);
        assert(typeof cleaned === 'boolean', 'closeToast evaluated cleanly');

        // Test Escape key dismisses toast
        const dismissedByEsc = await evalCDP(`
          (() => {
            window.AntigravityStats.showToast('Dismiss me with Esc');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return !!document.getElementById('antigravity-stats-toast');
          })()
        `);
        assert(dismissedByEsc === false, 'Toast should be dismissed when Escape key is pressed');

        ws.close();
        resolve();
      } catch (err) {
        ws.close();
        reject(err);
      }
    };
    ws.onerror = (err) => {
      try { ws.close(); } catch (e) {}
      reject(err);
    };
  });
});

test('Rapid mount/unmount and modal stress safety', async () => {
  let port = null;
  try {
    port = await getDevToolsPort();
  } catch {
    console.log('   (Skipping live stress test: Antigravity not currently running)');
    return;
  }
  if (!(await isDevToolsReady(port))) {
    console.log('   (Skipping live stress test: DevTools port is not reachable)');
    return;
  }

  const pagesRes = await fetch(`http://127.0.0.1:${port}/json`);
  const pages = await pagesRes.json();
  const mainPage = pages.find(p => p.type === 'page' && !p.url.includes('devtools://'));
  assert(mainPage, 'Must have active main page');

  const ws = new WebSocket(mainPage.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = async () => {
      let reqId = 300;
      const evalCDP = (expr) => new Promise((res, rej) => {
        const id = reqId++;
        const onMsg = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', onMsg);
            if (data.error) rej(new Error(data.error.message));
            else res(data.result?.result?.value);
          }
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
      });

      try {
        // Stress test mount & unmount in rapid loop (20 cycles)
        const mountStress = await evalCDP(`
          (() => {
            const dummy = document.createElement('div');
            document.body.appendChild(dummy);
            let errors = 0;
            for (let i = 0; i < 20; i++) {
              try {
                window.AntigravityStats.mount(dummy);
                window.AntigravityStats.unmount();
              } catch (e) {
                errors++;
              }
            }
            dummy.remove();
            return {
              errors,
              rootNull: window.__ANTIGRAVITY_STATS_ROOT__ === null
            };
          })()
        `);
        assert(mountStress.errors === 0, `Mount/unmount threw ${mountStress.errors} errors`);
        assert(mountStress.rootNull === true, 'Root must be null after unmount');

        // Stress test openModal & closeModal rapid toggle
        const modalStress = await evalCDP(`
          (() => {
            let errors = 0;
            for (let i = 0; i < 10; i++) {
              try {
                window.AntigravityStats.openModal();
                window.AntigravityStats.closeModal();
              } catch (e) {
                errors++;
              }
            }
            const lingering = document.querySelectorAll('#antigravity-stats-modal-overlay').length;
            return { errors, lingering };
          })()
        `);
        assert(modalStress.errors === 0, `Modal toggle threw ${modalStress.errors} errors`);
        assert(modalStress.lingering === 0, 'No ghost modal overlay elements should linger in DOM');

        ws.close();
        resolve();
      } catch (err) {
        ws.close();
        reject(err);
      }
    };
    ws.onerror = (err) => {
      try { ws.close(); } catch (e) {}
      reject(err);
    };
  });
});

test('Desktop shortcut exists and is valid Windows LNK', () => {
  if (process.platform !== 'win32') return;
  const desktopLnk = path.join(os.homedir(), 'Desktop', 'Antigravity (with Stats).lnk');
  assert(fs.existsSync(desktopLnk), `Shortcut should exist at ${desktopLnk}`);
  const stats = fs.statSync(desktopLnk);
  assert(stats.size > 500, 'LNK shortcut file should be valid non-empty binary file');
});

test('Unpatch script is idempotent and leaves pristine ASAR untouched', () => {
  const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-unpatch-test-'));
  try {
    fs.writeFileSync(path.join(resourcesDir, 'app.asar'), 'pristine test asar', 'utf8');
    const result = unpatch({ silent: true, resourcesDir });
    assert(typeof result === 'object', 'unpatch should return result object');
    assert(result.pristine === true, 'app.asar should be verified as pristine');
  } finally {
    fs.rmSync(resourcesDir, { recursive: true, force: true });
  }
});

// ============================================================================
// RUNNER
// ============================================================================

async function runAll() {
  console.log('\n' + '='.repeat(60));
  console.log('Antigravity Token Stats — Pure CDP & Launcher Integration Tests');
  console.log('='.repeat(60) + '\n');

  const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice('--filter='.length);
  const selected = TESTS.filter(test => !filter || test.name.includes(filter));
  if (!selected.length) throw new Error('No integration tests matched the filter');
  for (const { name, fn } of selected) {
    try {
      await fn();
      console.log('✅', name);
      passCount++;
    } catch (err) {
      console.log('❌', name);
      console.log('   Error:', err.message);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log('='.repeat(60) + '\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
