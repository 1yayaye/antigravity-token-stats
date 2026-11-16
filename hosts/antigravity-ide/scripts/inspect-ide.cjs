#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const contract = require('../../../src/injection-contract.cjs');
// Bounded native CDP acceptance; Browser plugin is unavailable.
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connect timed out')), 5000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')); };
    });
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data), request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Evaluation failed');
    return result.result?.value;
  }
  close() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); }
    this.pending.clear(); this.ws.close();
  }
}
async function withTarget(run, match = t => t.type === 'page' && t.url.includes('/workbench.html')) {
  const port = process.env.ANTIGRAVITY_IDE_CDP_PORT || '9222';
  if (!/^\d{1,5}$/.test(port)) throw new Error('Invalid CDP port');
  const response = await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('CDP list failed: ' + response.status);
  const target = (await response.json()).find(match);
  if (!target) throw new Error('Native IDE target unavailable');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  try { await cdp.opened; return await run(cdp); } finally { cdp.close(); }
}
async function verify(cdp) {
  const status = JSON.stringify(contract.CONTAINER_IDE_STATUSBAR_ID), popup = JSON.stringify(contract.CONTAINER_IDE_POPOVER_ID);
  const buttons = await cdp.evaluate('Array.from(document.getElementById(' + status + ')?.querySelectorAll("button[data-widget]") || [], e=>e.dataset.widget)');
  assert.deepEqual(buttons, ['session', 'tokens', 'context'], 'Three status widgets must render in order');
  const samples = {};
  const popupState = '(()=>{const p=document.getElementById(' + popup + ');if(!p)return null;const b=p.getBoundingClientRect(),t=document.getElementById(' + status + ').getBoundingClientRect();return {widget:p.dataset.widget,fits:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=t.top,rows:p.querySelectorAll("tbody tr").length};})()';
  const clickWidget = widget => cdp.evaluate('document.getElementById(' + status + ').querySelector("[data-widget=' + widget + ']").click()');
  for (const widget of buttons) {
    await clickWidget(widget);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (widget === 'tokens') {
      await cdp.evaluate('document.getElementById(' + popup + ')?.querySelector(\'[data-action="toggle-token-drawer"]\')?.click()');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const result = await cdp.evaluate(popupState);
    assert.equal(result?.widget, widget); assert.ok(result.fits, widget + ' must fit above status bar');
    if (widget === 'tokens') assert.equal(result.rows, 3);
    samples[widget] = result;
  }
  // Same-entry click closes; the popover stays closed until the entry is clicked again.
  const lastWidget = buttons[buttons.length - 1];
  await clickWidget(lastWidget);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await cdp.evaluate('!!document.getElementById(' + popup + ')'), false, 'same-entry click must close');
  await clickWidget(lastWidget);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await cdp.evaluate(popupState))?.widget, lastWidget, 'same-entry reopen must work');
  // A click far outside the popover closes it like an outside interaction.
  const viewport = await cdp.evaluate('({w:innerWidth,h:innerHeight})');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(viewport.w / 2), y: Math.round(viewport.h / 3), button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(viewport.w / 2), y: Math.round(viewport.h / 3), button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await cdp.evaluate('!!document.getElementById(' + popup + ')'), false, 'outside click must close');
  // Shrinking the layout viewport must keep the popover inside the window;
  // real OS-level window resizing stays a manual acceptance step.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 520, deviceScaleFactor: 0, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 300));
  await clickWidget('context');
  await new Promise(resolve => setTimeout(resolve, 100));
  const smallResult = await cdp.evaluate(popupState);
  assert.equal(smallResult?.widget, 'context');
  assert.ok(smallResult.fits, 'popover must fit in a small viewport');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await new Promise(resolve => setTimeout(resolve, 300));
  await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await new Promise(resolve => setTimeout(resolve,100));
  assert.equal(await cdp.evaluate('!!document.getElementById(' + popup + ')'),false);
  assert.equal(await cdp.evaluate('document.activeElement?.dataset.widget'),'context');
  return {passed:true,widgets:samples,smallWindow:smallResult.fits};
}
if (require.main === module) withTarget(async cdp => {
  if (process.argv[2] === '--eval') {
    if (!process.argv[3]) throw new Error('--eval needs expression');
    return cdp.evaluate(process.argv[3]);
  }
  if (process.argv[2] === '--screenshot') {
    if (!process.argv[3]) throw new Error('--screenshot needs PNG path');
    const result = await cdp.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(process.argv[3],Buffer.from(result.data,'base64'));
    return {screenshot:process.argv[3]};
  }
  if (process.argv[2] === '--state') {
    return cdp.evaluate(`(() => {
      const state = window[${JSON.stringify(contract.WINDOW_IDE_STATE)}];
      return { received: !!state, hasActiveChat: !!state?.activeSessionId,
        hasSession: !!state?.session, promptTokens: state?.session?.promptTokens,
        contextLimit: state?.contextLimit, hasStats: !!state?.stats,
        sessionCount: Object.keys(state?.stats?.sessions || {}).length,
        hasQuota: !!state?.quota, error: state?.error,
        widgets: Array.from(document.querySelectorAll('.anti-ide-widget-trigger'), e => e.textContent) };
    })()`);
  }
  if (process.argv[2] === '--models' || process.argv[2] === '--open-models') {
    if (process.argv[2] === '--open-models') {
      const opened = await cdp.evaluate(`(() => {
        const item = [...document.querySelectorAll('span,button,div')]
          .find(e => e.textContent.trim() === 'No Model Selected' && e.children.length === 0);
        if (!item) return null;
        item.click();
        return true;
      })()`);
      if (opened) {
        await new Promise(resolve=>setTimeout(resolve,1200));
      }
    }
    return cdp.evaluate(`(() => ({
      modelsError:document.body.innerText.includes('Error Loading Models'),
      timeout:document.body.innerText.includes('connectex'),
      oauth:document.body.innerText.includes('oauth2.googleapis.com'),
      noModelSelected:document.body.innerText.includes('No Model Selected'),
      hasModelChoice:[...document.querySelectorAll('[role=option],button')].some(e=>/Gemini|Claude/.test(e.textContent)),
      route:location.pathname, ready:document.readyState
    }))()`);
  }
  return verify(cdp);
}, ['--models','--open-models'].includes(process.argv[2])
  ? target=>target.type==='iframe' && target.url.startsWith('http://127.0.0.1:')
  : undefined).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error('[inspect-ide] '+error.message);process.exitCode=1;});
module.exports={Cdp,withTarget,verify};
