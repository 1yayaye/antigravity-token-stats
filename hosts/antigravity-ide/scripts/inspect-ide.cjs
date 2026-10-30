#!/usr/bin/env node
/**
 * Live inspection for the Antigravity IDE workbench via CDP, the IDE sibling of
 * hosts/antigravity/scripts/verify-real-device.cjs. Requires the IDE to be
 * started with --remote-debugging-port (e.g. via `npm run inspect:ide`).
 *
 * Usage:
 *   node inspect-ide.cjs                 overview: targets, activity bar, frames
 *   node inspect-ide.cjs --webview       open the Token Stats view and dump its DOM state
 *   node inspect-ide.cjs --eval "expr"   evaluate JS in the workbench main context
 */

const PORT = process.env.ANTIGRAVITY_IDE_CDP_PORT || '9222';

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`CDP /json returned ${res.status}`);
  return res.json();
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.contexts = new Map(); // executionContextId -> description
    this.pending = new Map();
    this.ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method === 'Runtime.executionContextCreated') {
        const c = msg.params.context;
        this.contexts.set(c.id, c);
      }
    });
    this.opened = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('CDP WebSocket connection failed'));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const p = new Promise((res, rej) => this.pending.set(id, { res, rej }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return p;
  }

  async evaluate(expr, contextId) {
    const result = await this.send('Runtime.evaluate', {
      expression: expr,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return result.result?.value;
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

async function withWorkbench(fn) {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  const workbench = pages.find((t) => t.url.includes('workbench')) || pages[0];
  if (!workbench) throw new Error('No workbench page target found — is the IDE running with the debug port?');
  console.log(`[CDP] port ${PORT}, targets: ${targets.length} (pages: ${pages.length})`);
  for (const t of targets) {
    console.log(`  - [${t.type}] ${t.title || '(untitled)'} :: ${t.url.slice(0, 90)}`);
  }
  const cdp = new Cdp(workbench.webSocketDebuggerUrl);
  try {
    await cdp.opened;
    await cdp.send('Runtime.enable');
    await new Promise((r) => setTimeout(r, 500)); // let context events arrive
    return await fn(cdp);
  } finally {
    cdp.close();
  }
}

const OVERVIEW_PROBE = `(() => {
  const bar = [...document.querySelectorAll('.activitybar .monaco-action-bar .action-item .action-label')]
    .map((el) => el.getAttribute('aria-label') || el.title || '');
  const badge = document.querySelector('.badge-content')?.textContent;
  return { title: document.title, theme: document.body.classList.contains('vscode-dark') ? 'dark' : 'light',
           activityBar: bar, badge };
})()`;

const WEBVIEW_PROBE = `(() => {
  // The webview CDP target's document is only the outer webview shell; the extension
  // content renders inside the nested active-frame iframe. The shell and the frame are
  // same-origin, so reach the inner document through frame.contentDocument and probe
  // there (fall back to the shell document when running directly inside the frame).
  const innerDoc = document.querySelector('iframe.active-frame')?.contentDocument || document;
  const root = innerDoc.querySelector('#root');
  const style = innerDoc.getElementById('antigravity-stats-styles');
  return {
    hasRoot: !!root,
    childCount: root ? root.childElementCount : 0,
    hasStyles: !!style,
    textSample: root ? root.innerText.replace(/\\s+/g, ' ').slice(0, 300) : null,
    canvases: innerDoc.querySelectorAll('canvas').length,
  };
})()`;

async function main() {
  const mode = process.argv[2];

  if (mode === '--eval') {
    const expr = process.argv[3];
    if (!expr) throw new Error('--eval needs an expression');
    const value = await withWorkbench((cdp) => cdp.evaluate(expr));
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  await withWorkbench(async (cdp) => {
    const overview = await cdp.evaluate(OVERVIEW_PROBE);
    console.log('\n[Workbench]', JSON.stringify(overview, null, 2));

    const statsEntry = overview.activityBar.find((label) => /token stats/i.test(label));
    if (!statsEntry) {
      console.log('\n[!] Token Stats container not in the activity bar yet. It may need the icon clicked once to activate.');
    }

    if (mode !== '--webview') {
      const frames = [...cdp.contexts.values()].map((c) => ({ id: c.id, name: c.name, origin: c.origin }));
      console.log('\n[Frames/contexts]', JSON.stringify(frames, null, 2));
      return;
    }

    // Open the Token Stats view by clicking its activity bar icon, then attach
    // to the webview iframe target (it is exposed as its own CDP target).
    await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('.activitybar .monaco-action-bar .action-item .action-label')]
        .find((n) => /token stats/i.test(n.getAttribute('aria-label') || n.title || ''));
      if (el) {
        const r = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
      }
      return !!el;
    })()`);
    await new Promise((r) => setTimeout(r, 3000));

    const targets = await listTargets();
    const frame = targets.find(
      (t) => t.type === 'iframe' && t.url.includes('extensionId=antigravity-local.antigravity-ide-token-stats'),
    );
    if (!frame) {
      console.log('\n[!] Token Stats webview iframe target not found — the view may not have opened.');
      return;
    }
    console.log(`\n[Webview target] ${frame.title || '(untitled)'}`);
    const frameCdp = new Cdp(frame.webSocketDebuggerUrl);
    try {
      await frameCdp.opened;
      const probe = await frameCdp.evaluate(WEBVIEW_PROBE);
      console.log(JSON.stringify(probe, null, 2));
    } finally {
      frameCdp.close();
    }
  });
}

main().catch((e) => {
  console.error(`[inspect-ide] ${e.message}`);
  process.exitCode = 1;
});
