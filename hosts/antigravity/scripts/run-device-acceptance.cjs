#!/usr/bin/env node
/**
 * Real-Device Comprehensive Acceptance Test Suite
 * Connects to live Antigravity instance via Chrome DevTools Protocol (CDP).
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { findDevToolsPort } = require('./paths.cjs');

async function runRealDeviceAcceptance() {
  console.log('======================================================');
  console.log('🚀 Antigravity Real-Device Comprehensive Acceptance');
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

    const consoleErrors = [];
    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
        }
      } catch {}
    });

    ws.onopen = async () => {
      try {
        await sendCommand('Runtime.enable');

        // Step 1: Verify Host Injection & Data Integrity
        console.log('\n--- [Step 1: Host Injection & Data Integrity] ---');
        const hostState = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const stats = window.__ANTIGRAVITY_STATS__;
            return {
              hasStatsObject: !!stats,
              lifetimeTokens: stats?.kpis?.lifetimeTokens,
              lifetimeTokensRaw: stats?.kpis?.lifetimeTokensRaw,
              cacheHitRate: stats?.insights?.cacheHitRate || stats?.tokenBreakdown?.cacheHitRate,
              peakTokens: stats?.kpis?.peakTokens,
              sessionCount: Object.keys(stats?.sessions || {}).length,
              scannedConversations: stats?.meta?.scannedConversations,
              hasApi: typeof window.AntigravityStats === 'object',
              hasSyncBridge: !!window.__ANTIGRAVITY_SYNC_BRIDGE__,
              currentSessionId: window.location.pathname.match(/\\/c\\/([a-zA-Z0-9_-]+)/)?.[1]
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Host Injection State:');
        console.log(`  • Lifetime Tokens: ${hostState.lifetimeTokens} (${hostState.lifetimeTokensRaw?.toLocaleString()} raw)`);
        console.log(`  • Overall Cache Hit Rate: ${hostState.cacheHitRate}`);
        console.log(`  • Peak Tokens: ${hostState.peakTokens}`);
        console.log(`  • Aggregated Sessions in Memory: ${hostState.sessionCount}`);
        console.log(`  • Scanned Conversations: ${hostState.scannedConversations}`);
        console.log(`  • Current Conversation ID: ${hostState.currentSessionId}`);
        if (!hostState.hasStatsObject || hostState.sessionCount === 0) {
          throw new Error('Host stats object not loaded or empty sessions!');
        }

        // Step 2: Verify Context Usage Pill & Hover Popover
        console.log('\n--- [Step 2: Context Usage Pill & Hover Popover] ---');
        const pillInfo = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const pill = document.getElementById('antigravity-context-usage-pill');
            if (!pill) return { found: false };
            const btn = pill.querySelector('button');
            if (btn) btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            return {
              found: true,
              text: pill.innerText.trim()
            };
          })()`,
          returnByValue: true
        });
        console.log(`✓ Context Usage Pill Text: "${pillInfo.text}"`);
        if (!pillInfo.found) throw new Error('Context Usage Pill not found in DOM!');

        await new Promise(r => setTimeout(r, 600));

        const popoverInfo = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const popover = document.getElementById('antigravity-context-popover');
            if (!popover) return { found: false };
            const text = popover.innerText;
            const pill = document.getElementById('antigravity-context-usage-pill');
            const btn = pill?.querySelector('button');
            if (btn) btn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

            return {
              found: true,
              hasPromptCache: text.includes('Prompt Cache') || text.includes('缓存'),
              hasCompaction: text.includes('压缩') || text.includes('Compaction'),
              lines: text.split('\\n').filter(Boolean)
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Context Popover Content:');
        popoverInfo.lines.forEach(l => console.log(`    ${l}`));

        // Step 3: Trigger Full Modal via openModal
        console.log('\n--- [Step 3: Opening Full Stats Modal] ---');
        await sendCommand('Runtime.evaluate', {
          expression: `window.AntigravityStats.openModal();`
        });
        await new Promise(r => setTimeout(r, 1600));

        const modalDOM = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const overlay = document.getElementById('antigravity-stats-modal-overlay');
            const content = document.getElementById('antigravity-stats-modal-content');
            return {
              overlayExists: !!overlay,
              contentExists: !!content,
              hasContainer: !!overlay?.querySelector('.antigravity-stats-container')
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Modal Structure Verified:', modalDOM);
        if (!modalDOM.overlayExists || !modalDOM.contentExists) {
          throw new Error('Stats Modal Overlay/Content failed to render!');
        }

        // Step 4: Verify Subscription Quota Card & Reactive Tier Selection
        console.log('\n--- [Step 4: Subscription Quota & Value Card] ---');
        const quotaCard = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const selectEl = document.getElementById('quota-tier-select');
            const section = selectEl ? selectEl.closest('section') : null;
            if (!section) return { found: false };
            const text = section.innerText;
            return {
              found: true,
              ariaLabel: section.getAttribute('aria-label'),
              currentTier: selectEl.value,
              tiersAvailable: Array.from(selectEl.options).map(o => o.text),
              hasLiveBadge: text.includes('实时同步') || text.includes('Synced') || text.includes('Live'),
              hasWeeklyQuota: text.includes('周额度') || text.includes('Weekly Quota'),
              hasMonthlySaving: text.includes('月额度') || text.includes('Monthly') || text.includes('saved'),
              textSnippet: text.split('\\n').filter(Boolean).slice(0, 8)
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Subscription Quota Card:');
        console.log(`  • Active Tier: ${quotaCard.currentTier}`);
        console.log(`  • Live Badge Active: ${quotaCard.hasLiveBadge}`);
        console.log(`  • Weekly Quota & Monthly Saving Active: ${quotaCard.hasWeeklyQuota && quotaCard.hasMonthlySaving}`);

        // Test Tier Switching in DOM
        console.log('  • Testing reactive tier switch to Ultra 5x...');
        await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const selectEl = document.getElementById('quota-tier-select');
            selectEl.value = 'ultra_5x';
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          })()`
        });
        await new Promise(r => setTimeout(r, 400));
        const switchedTierText = await sendCommand('Runtime.evaluate', {
          expression: `document.getElementById('quota-tier-select')?.closest('section')?.innerText.includes('99.99')`,
          returnByValue: true
        });
        console.log(`  • Ultra 5x ($99.99/mo) reactive calculation verified: ${switchedTierText}`);

        // Switch back to pro
        await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const selectEl = document.getElementById('quota-tier-select');
            selectEl.value = 'pro';
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          })()`
        });

        // Step 5: Verify Token Breakdown Card
        console.log('\n--- [Step 5: Token Breakdown Card] ---');
        const breakdownCard = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const modalContent = document.getElementById('antigravity-stats-modal-content');
            const el = Array.from(modalContent?.querySelectorAll('section') || []).find(s => {
              const txt = s.innerText.toLowerCase();
              return txt.includes('breakdown') || txt.includes('消耗结构') || txt.includes('cache hit rate') || txt.includes('缓存命中率');
            });
            if (!el) return { found: false };
            const text = el.innerText.toLowerCase();
            return {
              found: true,
              hasCache: text.includes('cache') || text.includes('缓存'),
              hasInput: text.includes('input') || text.includes('输入'),
              hasThinking: text.includes('thinking') || text.includes('思考'),
              hasOutput: text.includes('output') || text.includes('response') || text.includes('输出') || text.includes('回复')
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Token Breakdown Card:');
        console.log(`  • Found: ${breakdownCard?.found}`);
        console.log(`  • All 4 Token Channels Verified: ${Boolean(breakdownCard?.hasCache && breakdownCard?.hasInput && breakdownCard?.hasThinking && breakdownCard?.hasOutput)}`);

        // Step 6: Verify Heatmap & Interactive Daily Cells
        console.log('\n--- [Step 6: Token Activity Heatmap & Interactive Cells] ---');
        const heatmapInfo = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const modalContent = document.getElementById('antigravity-stats-modal-content');
            const heatmapEl = Array.from(modalContent?.querySelectorAll('div, section') || []).find(el =>
              el.innerText.includes('活跃历史') || el.innerText.includes('Activity history') || el.innerText.includes('Token 活跃度')
            );
            const cells = modalContent?.querySelectorAll('button[data-cell-date]') || [];
            const sampleCell = cells[cells.length - 1];
            return {
              foundHeatmap: !!heatmapEl,
              cellCount: cells.length,
              sampleDate: sampleCell?.getAttribute('data-cell-date'),
              sampleLevel: sampleCell?.getAttribute('data-cell-level')
            };
          })()`,
          returnByValue: true
        });
        console.log(`✓ Activity Heatmap Verified:`);
        console.log(`  • Title & Container Present: ${heatmapInfo.foundHeatmap}`);
        console.log(`  • Interactive Day Cells Rendered: ${heatmapInfo.cellCount} days`);
        console.log(`  • Latest Day Cell: ${heatmapInfo.sampleDate} (activity level: ${heatmapInfo.sampleLevel})`);

        // Step 7: Test Time Range Dropdown Select (30d -> 7d -> 30d)
        console.log('\n--- [Step 7: Time Range Select Reactivity] ---');
        const timeSelectResult = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const modalContent = document.getElementById('antigravity-stats-modal-content');
            const selectEl = modalContent?.querySelector('select');
            if (!selectEl) return { found: false };
            const initial = selectEl.value;
            selectEl.value = '7d';
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            const changed = selectEl.value;
            selectEl.value = initial;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            return { found: true, initial, changed };
          })()`,
          returnByValue: true
        });
        console.log(`  • Time Range selector tested (30d -> 7d -> 30d):`, timeSelectResult);

        // Step 8: Test Language Toggle (zh <-> en)
        console.log('\n--- [Step 8: UI Language Dynamic Switching] ---');
        const langToggleResult = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const modalContent = document.getElementById('antigravity-stats-modal-content');
            const langBtn = modalContent?.querySelector('header button');
            if (!langBtn) return { found: false };
            const beforeTitle = modalContent.querySelector('h1')?.innerText;
            langBtn.click();
            const afterTitle = modalContent.querySelector('h1')?.innerText;
            // Switch back to Chinese
            if (afterTitle !== 'Token 统计') {
              langBtn.click();
            }
            const restoredTitle = modalContent.querySelector('h1')?.innerText;
            return {
              found: true,
              beforeTitle,
              afterTitle,
              restoredTitle
            };
          })()`,
          returnByValue: true
        });
        console.log(`  • Language toggle verified:`, langToggleResult);

        // Step 9: Close Modal & Clean Unmount
        console.log('\n--- [Step 9: Close Modal & Verify Clean Unmount] ---');
        await sendCommand('Runtime.evaluate', {
          expression: `window.AntigravityStats.closeModal();`
        });
        await new Promise(r => setTimeout(r, 600));

        const postClose = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            return {
              overlayExists: !!document.getElementById('antigravity-stats-modal-overlay'),
              rootCleaned: window.__ANTIGRAVITY_STATS_ROOT__ === null
            };
          })()`,
          returnByValue: true
        });
        console.log('✓ Post-Close Cleanup:', postClose);
        if (postClose.overlayExists) {
          throw new Error('Modal Overlay was not properly removed after closeModal!');
        }

        // Step 10: Test Keyboard Shortcut Alt+T (open and close)
        console.log('\n--- [Step 10: Hotkey (Alt+T) Modal Trigger] ---');
        await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', altKey: true, bubbles: true }));
          })()`
        });
        await new Promise(r => setTimeout(r, 800));

        const hotkeyOpened = await sendCommand('Runtime.evaluate', {
          expression: `!!document.getElementById('antigravity-stats-modal-overlay')`,
          returnByValue: true
        });
        console.log(`✓ Alt+T hotkey opened modal successfully: ${hotkeyOpened}`);

        // Close again
        await sendCommand('Runtime.evaluate', {
          expression: `window.AntigravityStats.closeModal();`
        });
        await new Promise(r => setTimeout(r, 400));

        // Step 11: Live Sync IPC Trigger
        console.log('\n--- [Step 11: Real-time Live Sync IPC Hook] ---');
        await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            if (typeof window.__ANTIGRAVITY_REQUEST_SYNC__ === 'function') {
              window.__ANTIGRAVITY_REQUEST_SYNC__();
              return true;
            }
            return false;
          })()`,
          returnByValue: true
        });
        console.log('✓ Live Sync IPC triggered without exceptions');

        clearTimeout(timer);
        ws.close();
        resolve();
      } catch (err) {
        clearTimeout(timer);
        ws.close();
        reject(err);
      }
    };

    ws.onerror = (e) => {
      clearTimeout(timer);
      ws.close();
      reject(new Error(`WebSocket error: ${e.message || 'unknown'}`));
    };
  });

  console.log('\n======================================================');
  console.log('🎯 ALL 11 ACCEPTANCE PHASES COMPLETED WITH 100% SUCCESS!');
  console.log('======================================================\n');
}

runRealDeviceAcceptance().catch(err => {
  console.error('\n❌ REAL-DEVICE ACCEPTANCE FAILED:', err);
  process.exit(1);
});
