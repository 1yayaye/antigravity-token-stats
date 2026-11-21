import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import postcss, { AtRule, Root, Rule } from 'postcss';
import { resolve } from 'node:path';
import { STYLE_ELEMENT_ID, WINDOW_API, ZH_PACK_FILE } from './src/injection-contract.cjs';

const CONTAINER_SCOPES = [
  '.antigravity-stats-container',
  '.stats-view',
  '#antigravity-stats-modal-overlay',
  '.antigravity-statusbar-container',
  '.antigravity-statusbar',
  '.antigravity-statusbar-popover',
];

const SCOPE_SELECTOR = ':where(.antigravity-stats-container, .antigravity-statusbar-container)';

function isScopedSelector(sel: string): boolean {
  const s = sel.trim();
  if (s.startsWith(':where(.stats-view')) return true;
  return CONTAINER_SCOPES.some(
    (scope) =>
      s === scope ||
      s.startsWith(scope + ' ') ||
      s.startsWith(scope + '.') ||
      s.startsWith(scope + ':') ||
      s.startsWith(scope + '>') ||
      s.startsWith(scope + '[')
  );
}

function scopeRuleSelectors(rule: Rule): void {
  const next: string[] = [];
  for (const raw of rule.selectors) {
    const sel = raw.trim();
    if (!sel) continue;
    if (isScopedSelector(sel)) {
      next.push(sel);
      continue;
    }
    if (sel.startsWith('.') && !/[\s>+~]/.test(sel)) {
      next.push(`${SCOPE_SELECTOR}${sel}`);
    }
    next.push(`${SCOPE_SELECTOR} ${sel}`);
  }
  rule.selectors = next;
}

/**
 * Isolates injected desktop CSS from Antigravity's global stylesheet:
 * - Drops duplicate @keyframes pulse/spin already provided by Antigravity.
 * - Scopes all utility rules to our injected containers so 0 rules match host DOM.
 * - Places scoped utilities inside @layer components so Antigravity's @layer utilities
 *   always take precedence inside our containers while host-missing utilities still work.
 */
function isolateDesktopCss(cssCode: string): string {
  const root: Root = postcss.parse(cssCode);
  const baseLayer = postcss.atRule({ name: 'layer', params: 'base' });
  const utilityLayer = postcss.atRule({ name: 'layer', params: 'components' });

  const isBaseResetRule = (rule: Rule): boolean =>
    rule.selectors.some(
      (s) =>
        s.startsWith('.stats-view *') ||
        s.startsWith(':where(.stats-view') ||
        s === '.stats-view dd' ||
        s === '.stats-view dl' ||
        s === '.stats-view h1' ||
        s === '.stats-view h2' ||
        s === '.stats-view h3' ||
        s === '.stats-view button' ||
        s === '.stats-view select' ||
        s === '.stats-view :focus-visible'
    );

  const processNode = (node: postcss.ChildNode, targetContainer: Root | AtRule) => {
    if (node.type === 'atrule') {
      if (node.name === 'keyframes' && (node.params === 'pulse' || node.params === 'spin')) {
        node.remove();
        return;
      }
      if (node.name === 'layer') {
        node.walkRules((r) => scopeRuleSelectors(r));
        return;
      }
      if (node.name === 'media' || node.name === 'supports') {
        const cloned = node.clone();
        cloned.removeAll();
        let hasUtilityRules = false;
        node.each((child) => {
          if (child.type === 'rule') {
            if (child.selectors.every((s) => s.trim() === '.container')) {
              child.remove();
              return;
            }
            if (!child.selectors.every(isScopedSelector)) {
              const scoped = child.clone();
              scopeRuleSelectors(scoped);
              cloned.append(scoped);
              child.remove();
              hasUtilityRules = true;
            }
          }
        });
        if (hasUtilityRules) {
          utilityLayer.append(cloned);
        }
        if (!node.nodes || node.nodes.length === 0) {
          node.remove();
        }
        return;
      }
      return;
    }

    if (node.type === 'rule') {
      if (node.selectors.every((s) => s.trim() === '.container')) {
        node.remove();
        return;
      }
      if (isBaseResetRule(node)) {
        baseLayer.append(node.clone());
        node.remove();
        return;
      }
      if (node.selectors.every(isScopedSelector)) {
        return;
      }
      scopeRuleSelectors(node);
      if (targetContainer === root) {
        utilityLayer.append(node.clone());
        node.remove();
      }
    }
  };

  for (const child of [...root.nodes]) {
    processNode(child, root);
  }

  if (utilityLayer.nodes && utilityLayer.nodes.length > 0) {
    root.prepend(utilityLayer);
  }
  if (baseLayer.nodes && baseLayer.nodes.length > 0) {
    root.prepend(baseLayer);
  }

  return root.toString();
}

function inlineCssPlugin(isolateForHost: boolean): Plugin {
  return {
    name: 'inline-css-plugin',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      let cssCode = '';
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName.endsWith('.css') && asset.type === 'asset') {
          cssCode += asset.source;
          delete bundle[fileName];
        }
      }
      if (cssCode) {
        if (isolateForHost) {
          cssCode = isolateDesktopCss(cssCode);
        }
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (fileName.endsWith('.js') && chunk.type === 'chunk') {
            const injection = `
(function(){
  try {
    var prev = document.getElementById('${STYLE_ELEMENT_ID}');
    if (prev) {
      console.log('[AntigravityStats] Replacing existing styles version:', prev.getAttribute('data-version') || 'unknown');
      prev.remove();
    }
    var style = document.createElement('style');
    style.id = '${STYLE_ELEMENT_ID}';
    style.setAttribute('data-version', '1.0.1');
    style.textContent = ${JSON.stringify(cssCode)};
    document.head.appendChild(style);
  } catch(e) {
    console.error('[AntigravityStats] Failed to inject styles:', e);
  }
})();\n`;
            chunk.code = injection + chunk.code;
            break;
          }
        }
      }
    },
  };
}

// Injectable UI bundles, one entry/output per host target. Selected by HOST_TARGET
// (default "antigravity", the desktop client); "antigravity-ide" builds the IDE
// native workbench bundle and "antigravity-zh-pack" the optional Chinese
// translation pack. Desktop builds both via scripts/build-bundle.cjs because Vite
// supports a single lib entry per invocation. The desktop main bundle swaps the
// zh dictionary for an empty stub (real Chinese ships in the zh-pack instead);
// the IDE and zh-pack builds keep the real module inlined.
const HOST_TARGETS = {
  antigravity: {
    entry: 'hosts/antigravity/src/standalone.tsx',
    outDir: 'dist-bundle',
    fileName: 'antigravity-stats-bundle.js',
    emptyOutDir: true,
    zhStub: true,
  },
  'antigravity-ide': {
    entry: 'hosts/antigravity-ide/src/webview/standalone.tsx',
    outDir: 'hosts/antigravity-ide/dist',
    fileName: 'antigravity-stats-ide-bundle.js',
    // Preserve the separately built main-process host in the same output directory.
    emptyOutDir: false,
    zhStub: false,
  },
  'antigravity-zh-pack': {
    entry: 'hosts/antigravity/src/i18n/zh-pack.ts',
    outDir: 'dist-bundle',
    fileName: ZH_PACK_FILE,
    emptyOutDir: false,
    zhStub: false,
  },
} as const;

// Swaps the zh dictionary module for the empty stub so the desktop main bundle
// stays English-only (resolve.alias cannot match relative importees reliably).
function zhStubPlugin(): Plugin {
  const stubPath = resolve(__dirname, 'src/i18n/translations-zh-stub.ts');
  return {
    name: 'zh-stub-alias',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('translations-zh')) {
        return stubPath;
      }
    },
  };
}

const hostTarget = process.env.HOST_TARGET ?? 'antigravity';
const target = HOST_TARGETS[hostTarget as keyof typeof HOST_TARGETS];
if (!target) {
  throw new Error(
    `Unknown HOST_TARGET "${hostTarget}". Expected one of: ${Object.keys(HOST_TARGETS).join(', ')}.`,
  );
}

export default defineConfig({
  plugins: [react(), target.zhStub ? zhStubPlugin() : null, inlineCssPlugin(hostTarget === 'antigravity')].filter(Boolean),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: target.outDir,
    emptyOutDir: target.emptyOutDir,
    lib: {
      entry: target.entry,
      name: WINDOW_API,
      formats: ['iife'],
      fileName: () => target.fileName,
    },
    cssCodeSplit: false,
  },
});
