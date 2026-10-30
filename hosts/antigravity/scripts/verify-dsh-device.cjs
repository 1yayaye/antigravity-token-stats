#!/usr/bin/env node
/**
 * Real-Device Verification for DeepSeek Harness (DSH) Status Bar & Popovers
 * Tests live rendering and interactivity against running Antigravity via CDP.
 */

const fs = require('node:fs');
const path = require('node:path');
const { findDevToolsPort } = require('./paths.cjs');

async function runDshDeviceVerification() {
  console.log('======================================================');
  console.log('🎯 DSH Status Bar & Popovers Real-Device Acceptance');
  console.log('======================================================\n');

  const port = findDevToolsPort();
  console.log(`[CDP] Active DevTools Port: ${port}`);

  const pagesRes = await fetch(`http://127.0.0.1:${port}/json`);
  const pages = await pagesRes.json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith('http'));
  if (!page) throw new Error('No active web page target found in Antigravity');

  console.log(`[CDP] Connected Target: "${page.title}"`);
  console.log(`[CDP] Target URL: ${page.url}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('CDP connection timeout'));
    }, 35000);

    let idCounter = 1;
    function sendCommand(method, params = {}) {
      return new Promise((res, rej) => {
        const id = idCounter++;
        const onMsg = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.id === id) {
            ws.removeEventListener('message', onMsg);
            if (msg.error) rej(new Error(msg.error.message));
            else res(msg.result?.result?.value);
          }
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.onopen = async () => {
      try {
        await sendCommand('Runtime.enable');

        // Step 1: Verify Host Injection & API State
        console.log('\n--- [Step 1: Verify Host Injection & API State] ---');
        let apiState = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const api = window.AntigravityStats || {};
            return {
              hasApi: typeof window.AntigravityStats === 'object',
              hasMount: typeof api.mount === 'function',
              hasMountStatusBar: typeof api.mountStatusBar === 'function',
              hasUnmountStatusBar: typeof api.unmountStatusBar === 'function',
              hasRefreshStatusBar: typeof api.refreshStatusBar === 'function',
              hasStats: !!window.__ANTIGRAVITY_STATS__,
              hasStatusBar: !!document.getElementById('dsh-pill-performance'),
            };
          })()`,
          returnByValue: true
        });

        if (!apiState?.hasMountStatusBar || !apiState?.hasStatusBar) {
          console.log('[CDP] Reloading page to load latest bundle from dev-bundle.path...');
          await sendCommand('Page.enable');
          await sendCommand('Page.reload');
          // Wait for Antigravity cold/warm load to render status bar
          for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 500));
            const ready = await sendCommand('Runtime.evaluate', {
              expression: `!!document.getElementById('dsh-pill-performance')`,
              returnByValue: true
            }).catch(() => false);
            if (ready) {
              console.log(`[CDP] Status bar detected in ${((i + 1) * 0.5).toFixed(1)}s`);
              break;
            }
          }
        }

        apiState = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const api = window.AntigravityStats || {};
            return {
              hasApi: typeof window.AntigravityStats === 'object',
              hasMount: typeof api.mount === 'function',
              hasMountStatusBar: typeof api.mountStatusBar === 'function',
              hasUnmountStatusBar: typeof api.unmountStatusBar === 'function',
              hasRefreshStatusBar: typeof api.refreshStatusBar === 'function',
              hasStats: !!window.__ANTIGRAVITY_STATS__,
              hasStatusBarRoot: !!window.__ANTIGRAVITY_STATUSBAR_ROOT__,
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Injected API State:', apiState);
        if (!apiState.hasApi || !apiState.hasMountStatusBar) {
          throw new Error('AntigravityStats API missing or mountStatusBar not available');
        }

        // Step 2: Verify Status Bar Container & DOM Structure
        console.log('\n--- [Step 2: Status Bar DOM Structure] ---');
        // Allow React render queue to flush
        await new Promise(r => setTimeout(r, 800));

        const statusBarDOM = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const container = document.getElementById('antigravity-dsh-statusbar-container');
            const speedoPill = document.getElementById('dsh-pill-performance') || document.getElementById('dsh-pill-speedometer');
            const usagePill = document.getElementById('dsh-pill-usage');
            const contextPillWrap = document.getElementById('antigravity-context-usage-pill');
            const contextPillBtn = document.getElementById('dsh-pill-context');

            return {
              containerFound: !!container,
              speedoFound: !!speedoPill,
              speedoText: speedoPill ? speedoPill.innerText.trim() : null,
              usageFound: !!usagePill,
              usageText: usagePill ? usagePill.innerText.trim() : null,
              contextPillWrapFound: !!contextPillWrap,
              contextPillBtnFound: !!contextPillBtn,
              contextText: contextPillBtn ? contextPillBtn.innerText.trim() : null,
              hasDonutSvg: !!contextPillBtn?.querySelector('svg circle[stroke-dasharray]'),
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Status Bar DOM Verification:', statusBarDOM);
        if (!statusBarDOM.containerFound || !statusBarDOM.speedoFound || !statusBarDOM.usageFound || !statusBarDOM.contextPillBtnFound) {
          throw new Error('DSH Status Bar or one of its 3 pills not found in DOM!');
        }

        // Step 3: Test Speedometer Pill Popover (Session Stats)
        console.log('\n--- [Step 3: Speedometer Pill Hover -> Session Stats Popover] ---');
        await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const btn = document.getElementById('dsh-pill-performance') || document.getElementById('dsh-pill-speedometer');
            if (btn) {
              btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            }
          })()`
        });
        await new Promise(r => setTimeout(r, 500));

        const speedoPopover = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const popover = document.getElementById('antigravity-session-stats-popover');
            if (!popover) return { found: false };
            const text = popover.innerText;
            // Clean up hover
            const btn = document.getElementById('dsh-pill-performance') || document.getElementById('dsh-pill-speedometer');
            if (btn) {
              btn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
              btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            }

            return {
              found: true,
              hasModelTime: text.includes('模型用时') || text.includes('Model Time'),
              hasToolTime: text.includes('工具调用用时') || text.includes('Tool') || text.includes('工具'),
              hasTTFT: text.includes('TTFT') || text.includes('首 token'),
              hasSpeed: text.includes('TPS') || text.includes('输出速度') || text.includes('tok/s'),
              snippet: text.split('\\n').filter(Boolean).slice(0, 8)
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Session Stats Popover Result:', speedoPopover);
        if (!speedoPopover.found || !speedoPopover.hasModelTime || !speedoPopover.hasToolTime) {
          throw new Error('Session Stats Popover failed to render or missing fields!');
        }

        // Step 4: Test Usage Pill Popover (Token Usage)
        console.log('\n--- [Step 4: Usage Pill Hover -> Token Usage Popover] ---');
        await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const btn = document.getElementById('dsh-pill-usage');
            if (btn) {
              btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            }
          })()`
        });
        await new Promise(r => setTimeout(r, 500));

        const tokenPopover = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const popover = document.getElementById('antigravity-token-usage-popover');
            if (!popover) return { found: false };
            const text = popover.innerText;
            // Clean up hover
            const btn = document.getElementById('dsh-pill-usage');
            if (btn) {
              btn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
              btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            }

            return {
              found: true,
              hasTotalTokens: text.includes('Token 总数') || text.includes('Total Tokens') || text.includes('Token Usage') || text.includes('用量'),
              hasCacheHitRate: text.includes('缓存命中率') || text.includes('Cache Hit Rate') || text.includes('缓存'),
              hasInput: text.includes('未命中输入') || text.includes('Uncached Input') || text.includes('输入'),
              hasCacheRead: text.includes('缓存读取') || text.includes('Cache Read'),
              hasOutput: text.includes('生成输出') || text.includes('Output') || text.includes('输出'),
              snippet: text.split('\\n').filter(Boolean).slice(0, 10)
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Token Usage Popover Result:', tokenPopover);
        if (!tokenPopover.found || !tokenPopover.hasTotalTokens || !tokenPopover.hasCacheHitRate) {
          throw new Error('Token Usage Popover failed to render or missing fields!');
        }

        // Step 5: Test Context Pill Popover (Context Usage Breakdown)
        console.log('\n--- [Step 5: Context Pill Hover -> Context Usage Popover] ---');
        await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const btn = document.getElementById('dsh-pill-context');
            if (btn) {
              btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            }
          })()`
        });
        await new Promise(r => setTimeout(r, 500));

        const contextPopover = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const popover = document.getElementById('antigravity-context-popover');
            if (!popover) return { found: false };
            const text = popover.innerText;
            // Clean up hover
            const btn = document.getElementById('dsh-pill-context');
            if (btn) {
              btn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
              btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            }

            return {
              found: true,
              hasContextUsed: text.includes('上下文已用') || text.includes('Context Used'),
              hasSystemPrompt: text.includes('系统提示词') || text.includes('System Prompt'),
              hasToolDef: text.includes('工具定义') || text.includes('Tool Definitions'),
              hasChatMsg: text.includes('对话消息') || text.includes('Chat Messages'),
              hasCompaction: text.includes('256K') || text.includes('压缩') || text.includes('Compaction'),
              snippet: text.split('\\n').filter(Boolean).slice(0, 10)
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Context Usage Popover Result:', contextPopover);
        if (!contextPopover.found || !contextPopover.hasContextUsed || !contextPopover.hasCompaction) {
          throw new Error('Context Usage Popover failed to render or missing fields!');
        }

        // Step 6: Popover Viewport Boundary & Positioning Check
        console.log('\n--- [Step 6: Popover Boundary & Portal Check] ---');
        const portalInfo = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const btn = document.getElementById('dsh-pill-performance') || document.getElementById('dsh-pill-speedometer');
            if (btn) {
              btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            }
            const popoverContainer = document.getElementById('antigravity-dsh-popover-container');
            const isDirectChildOfBody = popoverContainer?.parentElement === document.body;
            const rect = popoverContainer?.getBoundingClientRect();
            if (btn) {
              btn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
              btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            }

            return {
              portalRendered: !!popoverContainer,
              isDirectChildOfBody,
              top: rect ? rect.top : null,
              left: rect ? rect.left : null,
              withinViewport: rect ? (rect.left >= 0 && rect.top >= 0) : false
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Portal Viewport Placement:', portalInfo);
        if (!portalInfo.portalRendered || !portalInfo.isDirectChildOfBody || !portalInfo.withinViewport) {
          throw new Error('Popover Portal placement failed viewport boundaries!');
        }

        console.log('\n======================================================');
        console.log('🎯 ALL 6 DSH ACCEPTANCE STEPS COMPLETED WITH 100% SUCCESS!');
        console.log('======================================================');
        clearTimeout(timer);
        ws.close();
        resolve();
      } catch (err) {
        clearTimeout(timer);
        ws.close();
        reject(err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

runDshDeviceVerification().catch(err => {
  console.error('\n❌ Real-device DSH acceptance failed:', err.message);
  process.exit(1);
});
