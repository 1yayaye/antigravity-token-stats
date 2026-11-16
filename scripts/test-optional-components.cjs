#!/usr/bin/env node
/**
 * Optional installer components: Chinese translation pack + status-bar widget switch.
 * Covers the contract surface, the patch options -> contract.json features mapping,
 * and the loader's zh-pack fallback at the pure-function level.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const contract = require(path.join(repoRoot, 'src', 'injection-contract.cjs'));

console.log('--- Testing Optional Installer Components (zh-pack / status-bar switch) ---');

// 1. Contract exports are complete and single-sourced
assert.strictEqual(contract.WINDOW_ZH_PACK, '__ANTIGRAVITY_ZH_PACK__', 'WINDOW_ZH_PACK must be the zh-pack window global');
assert.strictEqual(contract.ZH_PACK_FILE, 'antigravity-stats-zh-pack.js', 'ZH_PACK_FILE must be the zh-pack file name');
assert.strictEqual(contract.WINDOW_STATS_FEATURES, '__ANTIGRAVITY_STATS_FEATURES__', 'WINDOW_STATS_FEATURES must be the features window global');
assert.deepStrictEqual(contract.FEATURES, { statusBar: true }, 'FEATURES must be the contract.json features baseline');

const contractDecl = fs.readFileSync(path.join(repoRoot, 'src', 'injection-contract.d.cts'), 'utf8');
for (const name of ['WINDOW_ZH_PACK', 'ZH_PACK_FILE', 'WINDOW_STATS_FEATURES', 'FEATURES']) {
  assert(contractDecl.includes(`export const ${name}`), `injection-contract.d.cts must declare ${name} for TS consumers`);
}
console.log('PASS: Contract exports WINDOW_ZH_PACK / ZH_PACK_FILE / WINDOW_STATS_FEATURES / FEATURES');

// 2. i18n split: zh strings live in translations-zh.ts + stub, not in translations.ts
const translationsSource = fs.readFileSync(path.join(repoRoot, 'src', 'i18n', 'translations.ts'), 'utf8');
const zhSource = fs.readFileSync(path.join(repoRoot, 'src', 'i18n', 'translations-zh.ts'), 'utf8');
const zhStubSource = fs.readFileSync(path.join(repoRoot, 'src', 'i18n', 'translations-zh-stub.ts'), 'utf8');
assert(translationsSource.includes("import { zhTranslations } from './translations-zh'"), 'translations.ts must merge translations-zh');
assert(!translationsSource.includes('切换语言'), 'translations.ts must not inline zh strings');
assert(zhSource.includes('切换语言') && zhSource.includes('数据看板'), 'translations-zh.ts must carry the stats zh strings');
assert(zhStubSource.includes('zhTranslations: Record<string, string> = {}'), 'stub must export an empty zhTranslations');

// 3. Bundle split: main bundle English-only with zh-pack reference; zh-pack carries both
// dictionaries (mirrors the acceptance gates; builds bundles when missing).
const bundlePath = path.join(repoRoot, 'dist-bundle', 'antigravity-stats-bundle.js');
if (!fs.existsSync(bundlePath)) {
  const { execFileSync } = require('node:child_process');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['run', 'build:bundle'], { cwd: repoRoot, stdio: 'inherit', shell: true });
}
const zhPackPath = path.join(repoRoot, 'dist-bundle', contract.ZH_PACK_FILE);
assert(fs.existsSync(zhPackPath), 'dist-bundle must contain the zh-pack build output');
const bundleContent = fs.readFileSync(bundlePath, 'utf8');
const zhPackContent = fs.readFileSync(zhPackPath, 'utf8');
assert(bundleContent.includes(contract.WINDOW_ZH_PACK), 'main bundle must reference the zh-pack global');
assert(bundleContent.includes(contract.WINDOW_STATS_FEATURES), 'main bundle must reference the features global');
assert(!bundleContent.includes('新建对话') && !bundleContent.includes('切换语言'), 'main bundle must stay English-only');
assert(zhPackContent.includes('新建对话') && zhPackContent.includes('切换语言'), 'zh-pack must carry both dictionaries');
console.log('PASS: Bundle/zh-pack split keeps Chinese out of the main bundle');

// 4. JS patcher maps CLI options onto contract.json features and the conditional manifest
const patchScript = fs.readFileSync(path.join(repoRoot, 'hosts', 'antigravity', 'scripts', 'patch-antigravity.cjs'), 'utf8');
assert(patchScript.includes('--no-zh-pack'), 'JS patcher must accept --no-zh-pack');
assert(patchScript.includes('--no-status-bar'), 'JS patcher must accept --no-status-bar');
assert(patchScript.includes('contract.ZH_PACK_FILE'), 'JS patcher must copy the zh-pack via the contract file name');
assert(patchScript.includes('{ ...contract.FEATURES, statusBar: includeStatusBar }'), 'contract.json features must derive from contract.FEATURES');
assert(patchScript.includes('withZhPack !== false'), 'patch(options) must keep zh-pack on unless opted out');
assert(patchScript.includes('withStatusBar !== false'), 'patch(options) must keep the status bar on unless opted out');

// 5. Loader: zh-pack executes before the main bundle; features global comes from contract.json
const loaderScript = fs.readFileSync(path.join(repoRoot, 'hosts', 'antigravity', 'scripts', 'loader.cjs'), 'utf8');
assert(loaderScript.includes('getZhPackCode()'), 'loader must resolve the zh-pack code');
assert(
  loaderScript.indexOf('executeJavaScript(zhPackCode)') !== -1 &&
  loaderScript.indexOf('executeJavaScript(zhPackCode)') < loaderScript.indexOf('executeJavaScript(bundleCode)'),
  'loader must execute the zh-pack before the main bundle'
);
assert(loaderScript.includes('contract.WINDOW_STATS_FEATURES'), 'loader setup script must set the features global');
assert(loaderScript.includes("require('./contract.json').features"), 'loader features value must come from contract.json');

// Pure-function level: getZhPackCode falls back to __dirname when no main bundle
// (dev redirect or asar sibling) resolves next to it, and tolerates a missing file.
const { resolveZhPackCandidatePaths, getZhPackCode } = require(path.join(repoRoot, 'hosts', 'antigravity', 'scripts', 'loader.cjs'));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-optional-components-'));
try {
  const candidates = resolveZhPackCandidatePaths();
  assert(candidates.some((p) => path.basename(p) === contract.ZH_PACK_FILE), 'zh-pack candidates must end with the contract file name');
  assert(candidates.some((p) => p.startsWith(path.join(repoRoot, 'hosts', 'antigravity', 'scripts'))), 'zh-pack candidates must include the script dir fallback');

  // Point the dev redirect at an empty temp dir: no sibling zh-pack and no bundle ->
  // getZhPackCode() must return null (English fallback) instead of throwing.
  const pathsMod = require(path.join(repoRoot, 'hosts', 'antigravity', 'scripts', 'paths.cjs'));
  const redirectFile = pathsMod.getDevBundlePathFile();
  const prevRedirect = fs.existsSync(redirectFile) ? fs.readFileSync(redirectFile, 'utf8') : null;
  fs.mkdirSync(path.dirname(redirectFile), { recursive: true });
  fs.writeFileSync(redirectFile, path.join(tmpRoot, 'missing-bundle.js'), 'utf8');
  try {
    assert.strictEqual(getZhPackCode(), null, 'missing zh-pack must resolve to null (English fallback)');
  } finally {
    if (prevRedirect === null) {
      try { fs.unlinkSync(redirectFile); } catch {}
    } else {
      fs.writeFileSync(redirectFile, prevRedirect, 'utf8');
    }
  }
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
}
console.log('PASS: Loader zh-pack fallback and feature-flag wiring verified');

// 6. C# installer exposes the same option surface
const patcherCs = fs.readFileSync(path.join(repoRoot, 'hosts', 'antigravity', 'installer', 'Services', 'AsarPatcher.cs'), 'utf8');
assert(patcherCs.includes('bool includeZhPack = true'), 'C# Patch must take includeZhPack');
assert(patcherCs.includes('bool statusBarEnabled = true'), 'C# Patch must take statusBarEnabled');
assert(patcherCs.includes('SerializeContractWithFeatures'), 'C# Patch must rewrite contract.json features');
const programCs = fs.readFileSync(path.join(repoRoot, 'hosts', 'antigravity', 'installer', 'Program.cs'), 'utf8');
assert(programCs.includes('--no-zh-pack') && programCs.includes('--no-status-bar'), 'C# CLI must accept --no-zh-pack / --no-status-bar');
const mainFormCs = fs.readFileSync(path.join(repoRoot, 'hosts', 'antigravity', 'installer', 'UI', 'MainForm.cs'), 'utf8');
assert(mainFormCs.includes('_chkZhPack = new CheckBox') && mainFormCs.includes('Checked = false'), 'installer GUI must offer the zh-pack checkbox unchecked by default');
assert(mainFormCs.includes('_chkStatusBar = new CheckBox'), 'installer GUI must offer the status-bar checkbox');

// 7. Installer assets include the zh-pack and the default features payload
const prepareAssets = fs.readFileSync(path.join(repoRoot, 'hosts', 'antigravity', 'installer-gen', 'prepare-assets.cjs'), 'utf8');
assert(prepareAssets.includes('contract.ZH_PACK_FILE'), 'prepare-assets must copy the zh-pack');
assert(prepareAssets.includes('features: contract.FEATURES'), 'prepare-assets contract.json must carry contract.FEATURES');
const embeddedContractPath = path.join(repoRoot, 'hosts', 'antigravity', 'installer', 'EmbeddedAssets', 'contract.json');
if (!fs.existsSync(embeddedContractPath)) {
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(repoRoot, 'hosts', 'antigravity', 'installer-gen', 'prepare-assets.cjs'), '--skip-bundle'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}
const embeddedContract = JSON.parse(fs.readFileSync(embeddedContractPath, 'utf8'));
assert.deepStrictEqual(embeddedContract.features, contract.FEATURES, 'Embedded contract.json features must match contract.FEATURES (run npm run build:installer after prepare-assets)');
assert(fs.existsSync(path.join(repoRoot, 'hosts', 'antigravity', 'installer', 'EmbeddedAssets', contract.ZH_PACK_FILE)), 'EmbeddedAssets must contain the zh-pack');
console.log('PASS: C# installer and embedded assets expose the optional components');

// 8. Runtime English clamp when zh-pack is absent under a Chinese locale (prevents half-zh/half-en UI)
{
  const vm = require('node:vm');
  const ts = require('typescript');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { createRequire } = require('node:module');

  const prevWindow = global.window;
  const prevNavigator = global.navigator;
  const prevLocalStorage = global.localStorage;
  const origTsExt = require.extensions['.ts'];
  const origTsxExt = require.extensions['.tsx'];
  const compileTs = (mod, filename) => {
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    mod._compile(compiled, filename);
  };
  require.extensions['.ts'] = compileTs;
  require.extensions['.tsx'] = compileTs;

  try {
    global.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    global.navigator = { language: 'zh-CN' };
    global.localStorage = { getItem: () => 'zh', setItem() {} };

    // Load LanguageContext + StatsHeader + HeatmapDailyCalendarGrid with empty translations-zh stub
    const stubTranslationsPath = require.resolve(path.join(repoRoot, 'src', 'i18n', 'translations-zh.ts'));
    const translationsPath = require.resolve(path.join(repoRoot, 'src', 'i18n', 'translations.ts'));
    const realZhCache = require.cache[stubTranslationsPath];
    const realTranslationsCache = require.cache[translationsPath];
    require.cache[stubTranslationsPath] = {
      id: stubTranslationsPath,
      filename: stubTranslationsPath,
      loaded: true,
      exports: { zhTranslations: {} },
    };
    delete require.cache[translationsPath];
    const lcPath = require.resolve(path.join(repoRoot, 'src', 'i18n', 'LanguageContext.tsx'));
    const headerPath = require.resolve(path.join(repoRoot, 'src', 'components', 'stats', 'StatsHeader.tsx'));
    const gridPath = require.resolve(path.join(repoRoot, 'src', 'components', 'stats', 'HeatmapDailyCalendarGrid.tsx'));
    delete require.cache[lcPath];
    delete require.cache[headerPath];
    delete require.cache[gridPath];

    try {
      const { LanguageProvider, hasZhStatsSupport } = require(lcPath);
      const { StatsHeader } = require(headerPath);
      const { HeatmapDailyCalendarGrid } = require(gridPath);

      assert.strictEqual(hasZhStatsSupport(), false, 'Stubbed translations without zh-pack must report no zh support');
      const uiI18nPath = require.resolve(path.join(repoRoot, 'hosts', 'antigravity', 'src', 'i18n', 'antigravity-ui-i18n.ts'));
      delete require.cache[uiI18nPath];
      const { AntigravityUITranslator } = require(uiI18nPath);
      const translator = new AntigravityUITranslator();
      assert.strictEqual(translator.getLanguage(), 'en', 'Translator must default to en when zh-pack uiDict is absent');
      translator.setLanguage('zh');
      assert.strictEqual(translator.getLanguage(), 'en', 'Translator must refuse switching to zh when zh-pack uiDict is absent');

      const { DshStatusBar } = require(path.join(repoRoot, 'src', 'components', 'dsh', 'DshStatusBar.tsx'));
      const html = renderToStaticMarkup(
        React.createElement(
          LanguageProvider,
          null,
          React.createElement(StatsHeader, { timeRange: '30d', onTimeRangeChange: () => {}, onRefresh: () => {}, isRefreshing: false }),
          React.createElement(HeatmapDailyCalendarGrid, {
            calendar: [],
            totalWeeks: 0,
            monthHeaders: [],
            todayKey: '2026-11-16',
            activeCell: null,
            onTriggerPopover: () => {},
            onClearHoverPopover: () => {},
            onSetFocusedDate: () => {},
          }),
          React.createElement(DshStatusBar, {
            lang: translator.getLanguage(),
            telemetry: {
              sessionId: 'test',
              isStreaming: false,
              session: { rounds: 1, steps: 2, tps: 50, modelDurationSec: 1, toolDurationSec: 0, ttftSec: 0.5 },
              token: { totalTokens: 100, cacheHitRatePct: 50, uncachedInputTokens: 50, cacheReadTokens: 50, outputTokens: 20 },
              context: { usedTokens: 100, limitTokens: 256000, usedPct: 1, systemPromptTokens: 0, toolDefinitionTokens: 0, chatMessageTokens: 100 },
            },
          })
        )
      );
      assert(!/[\u4e00-\u9fff]/.test(html), `UI without zh-pack under zh-CN must stay pure English, got Chinese text in: ${html}`);
      assert(!html.includes('Switch language'), 'Language toggle button should be hidden when zh-pack is absent');
    } finally {
      if (realZhCache) require.cache[stubTranslationsPath] = realZhCache;
      else delete require.cache[stubTranslationsPath];
      if (realTranslationsCache) require.cache[translationsPath] = realTranslationsCache;
      else delete require.cache[translationsPath];
      delete require.cache[lcPath];
      delete require.cache[headerPath];
      delete require.cache[gridPath];
    }
  } finally {
    global.window = prevWindow;
    global.navigator = prevNavigator;
    global.localStorage = prevLocalStorage;
    require.extensions['.ts'] = origTsExt;
    require.extensions['.tsx'] = origTsxExt;
  }
  console.log('PASS: Missing zh-pack clamps UI & translator language to pure English even under zh-CN');
}

console.log('ALL Optional Installer Components tests passed successfully!\n');
