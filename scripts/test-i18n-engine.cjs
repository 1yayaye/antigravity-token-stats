#!/usr/bin/env node
/**
 * Test Suite for Antigravity 2.0 UI Chinese Localization Engine
 */

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

console.log('--- Testing Antigravity 2.0 UI Localization (i18n) Engine ---');

// 1. Verify bundle contains i18n symbols (auto-build bundle if missing)
const bundlePath = path.join(__dirname, '..', 'dist-bundle', 'antigravity-stats-bundle.js');
if (!fs.existsSync(bundlePath)) {
  const { execFileSync } = require('node:child_process');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['run', 'build:bundle'], { cwd: path.join(__dirname, '..'), stdio: 'inherit', shell: true });
}
assert(fs.existsSync(bundlePath), 'Bundle file should exist');
const bundleContent = fs.readFileSync(bundlePath, 'utf8');

assert(bundleContent.includes('AntigravityI18n') || bundleContent.includes('antigravityI18n'), 'Bundle must expose AntigravityI18n');
assert(bundleContent.includes('新建对话'), 'Bundle must contain Chinese translation dictionary');
assert(bundleContent.includes('深度思考中'), 'Bundle must contain tool status translations');
assert(bundleContent.includes('系统设置') || bundleContent.includes('自定义配置'), 'Bundle must contain settings translations');
console.log('PASS: Bundle includes i18n symbols and dictionary');

// 2. Load dictionary definitions directly from TypeScript source for validation
const dictPath = path.join(__dirname, '..', 'src', 'i18n', 'antigravity-ui-dict.ts');
assert(fs.existsSync(dictPath), 'Dictionary file should exist');
const dictSource = fs.readFileSync(dictPath, 'utf8');

// Basic dictionary syntax and integrity
assert(dictSource.includes('UI_EXACT_MAP'), 'UI_EXACT_MAP should be exported');
assert(dictSource.includes('UI_DYNAMIC_RULES'), 'UI_DYNAMIC_RULES should be exported');
assert(dictSource.includes('EXCLUSION_SELECTORS'), 'EXCLUSION_SELECTORS should be exported');

// Verify exclusion selectors include critical programming safety selectors
const criticalExclusions = [
  'pre',
  'code',
  '.syntax-highlighter',
  '[data-syntax-highlighter]',
  '[data-message-content]',
  '.prose',
  '.markdown-body',
  'textarea',
  '[contenteditable="true"]'
];

for (const sel of criticalExclusions) {
  assert(dictSource.includes(sel), `Exclusion list must contain critical code/chat selector: ${sel}`);
}
console.log('PASS: Critical code block and chat content exclusion selectors verified');

// 2b. Terms that must stay English (see the antigravity-ui-dict.ts header comment)
const keepEnglish = [
  'Skills', 'Rules', 'MCP Servers', 'Plugins', 'Hooks', 'Walkthrough',
  'Low', 'Medium', 'High', 'Extra High', 'Error',
  'Google AI Pro', 'Google AI Ultra',
  'Artifacts', 'Artifact', 'Code Diff', 'Tokens', 'Review', 'Turbo', 'Tab'
];
for (const term of keepEnglish) {
  const mapping = new RegExp(`^\\s*'${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':`, 'm');
  assert(!mapping.test(dictSource), `${term} must stay English (no Chinese mapping)`);
}

// 2c. Sentence-case lookup so variants like "New conversation" still translate
assert(dictSource.includes('UI_EXACT_MAP_LOWER'), 'Dictionary must expose a sentence-case lookup');
assert(dictSource.includes('export function lookupTranslation'), 'Dictionary must export lookupTranslation');

// 2d. Ambiguous Chinese values must stay limited to the known, documented pairs
const pairs = [...dictSource.matchAll(/^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?$/gm)];
assert(pairs.length > 150, `Dictionary should keep its entries (found ${pairs.length})`);
const seenChinese = new Map();
const duplicateChinese = new Set();
for (const [, en, zh] of pairs) {
  if (seenChinese.has(zh)) duplicateChinese.add(zh);
  else seenChinese.set(zh, en);
}
assert.deepStrictEqual(
  [...duplicateChinese].sort(),
  ['关闭', '思考强度'],
  `Unexpected duplicate Chinese values: ${[...duplicateChinese].join(', ')}`
);
console.log('PASS: English-only terms, sentence-case lookup, and duplicate-value guard verified');

// 3. Exercise the shipped dictionary and engine (not a copy of the rules)
const ts = require('typescript');
require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(compiled, filename);
};

const dict = require(dictPath);
const { AntigravityUITranslator } = require(path.join(__dirname, '..', 'src', 'i18n', 'antigravity-ui-i18n.ts'));
const engine = new AntigravityUITranslator();

function testTranslate(trimmed) {
  const exact = dict.lookupTranslation(trimmed);
  if (exact) return exact;
  for (const rule of dict.UI_DYNAMIC_RULES) {
    if (rule.pattern.test(trimmed)) return trimmed.replace(rule.pattern, rule.replace);
  }
  return null;
}

assert.strictEqual(testTranslate('Thought for 12.3s'), '已思考 12.3 秒');
assert.strictEqual(testTranslate('Thought for 4 seconds'), '已思考 4 秒');
assert.strictEqual(testTranslate('Thought for 1m 20s'), '已思考 1 分 20 秒');
assert.strictEqual(testTranslate('Thought for 3 minutes'), '已思考 3 分钟');
assert.strictEqual(testTranslate('Thought for 2 hours'), '已思考 2 小时');
assert.strictEqual(testTranslate('Worked for 1m'), '已工作 1 分钟');
assert.strictEqual(testTranslate('Worked for 12m'), '已工作 12 分钟');
assert.strictEqual(testTranslate('Worked for 45s'), '已工作 45 秒');
assert.strictEqual(testTranslate('Worked for 2h'), '已工作 2 小时');
assert.strictEqual(testTranslate('Show 1 breakdown'), '展开查看 1 项明细');
assert.strictEqual(testTranslate('Show 7 breakdowns'), '展开查看 7 项明细');
assert.strictEqual(testTranslate('Hide 4 breakdowns'), '收起 4 项明细');
assert.strictEqual(testTranslate('5m ago'), '5 分钟前');
assert.strictEqual(testTranslate('2h ago'), '2 小时前');
assert.strictEqual(testTranslate('3d ago'), '3 天前');
assert.strictEqual(testTranslate('22h'), '22 小时');
assert.strictEqual(testTranslate('1d'), '1 天');
assert.strictEqual(testTranslate('1mo'), '1 个月');
assert.strictEqual(testTranslate('2y'), '2 年');
assert.strictEqual(testTranslate('1M'), null, '1M (tokens) must not translate to 1 minute');
assert.strictEqual(testTranslate('2D'), null, '2D must not translate to 2 days');
assert.strictEqual(testTranslate('3D'), null, '3D must not translate to 3 days');
assert.strictEqual(testTranslate('24 active conversations and 1 archived conversation'), '24 个活动对话与 1 个归档对话');
assert.strictEqual(testTranslate('1 active conversation'), '1 个活动对话');
assert.strictEqual(testTranslate('0 archived conversations'), '0 个归档对话');
assert.strictEqual(testTranslate('Permanently delete anti token including 24 active conversations and 1 archived conversation.'), '永久删除 anti token，包含 24 个活动对话与 1 个归档对话。');
assert.strictEqual(testTranslate('Send feedback as test@gmail.com'), '以此身份发送反馈：test@gmail.com');
assert.strictEqual(testTranslate('3 files'), '3 个文件');
assert.strictEqual(testTranslate('1 file'), '1 个文件');
assert.strictEqual(testTranslate('9 files changed'), '9 个文件已修改');
assert.strictEqual(testTranslate('9 files changed +839 -7 >'), '9 个文件已修改 +839 -7 >');
assert.strictEqual(testTranslate('Custom prompt from user'), null);
assert.strictEqual(testTranslate('constructor'), null, 'Object.prototype members must not translate');
console.log('PASS: Dynamic RegExp pattern transformations work accurately');

// 4. Whitespace preservation through the real engine
assert.strictEqual(engine.translateText('  \n  New Conversation  \t'), '  \n  新建对话  \t');
assert.strictEqual(engine.translateText('constructor'), null);
console.log('PASS: Whitespace preservation logic works accurately');

// 5. DOM-facing bookkeeping (stores, revert, hot re-injection) in an isolated process
const repoRoot = path.join(__dirname, '..');
const engineProbeScript = `
const fs = require('fs');
const assert = require('assert');
const ts = require(${JSON.stringify(require.resolve('typescript'))});

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(compiled, filename);
};

let walkNodes = [];
global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
global.NodeFilter = { SHOW_TEXT: 4, SHOW_ELEMENT: 1 };
global.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
global.localStorage = { getItem: () => null, setItem() {} };
global.navigator = { language: 'en-US' };
global.MutationObserver = class { observe() {} disconnect() {} };
global.document = {
  body: { nodeType: 1, matches: () => false, closest: () => null },
  createTreeWalker: () => ({ nextNode: () => walkNodes.shift() || null }),
};

const { AntigravityUITranslator } = require(${JSON.stringify(path.join(repoRoot, 'src', 'i18n', 'antigravity-ui-i18n.ts'))});
const engine = new AntigravityUITranslator();
const textNode = (value) => ({ nodeType: 3, nodeValue: value, parentElement: null });

// stop() must revert this instance's text before a hot re-injection replaces it.
const stale = textNode('New Conversation');
engine.translateTextNode(stale);
assert.strictEqual(stale.nodeValue, '新建对话');
walkNodes = [stale];
engine.stop();
assert.strictEqual(stale.nodeValue, 'New Conversation', 'stop() must restore translated text');

// A node the engine never touched must survive a revert unchanged.
const untouched = textNode('关闭');
walkNodes = [untouched];
engine.revertSubtree(untouched);
assert.strictEqual(untouched.nodeValue, '关闭', 'untranslated text must not be rewritten');

// Host-updated text reverts to the latest host value, not the first one seen.
const updated = textNode('Thought for 12.3s');
engine.translateTextNode(updated);
updated.nodeValue = 'Thought for 13.0s';
engine.translateTextNode(updated);
walkNodes = [updated];
engine.revertSubtree(updated);
assert.strictEqual(updated.nodeValue, 'Thought for 13.0s', 'revert must use the refreshed original');

// Attributes follow the same refresh rule.
const el = {
  nodeType: 1,
  matches: () => false,
  closest: () => null,
  attrs: { title: 'Off' },
  getAttribute(name) { return this.attrs[name] ?? null; },
  setAttribute(name, value) { this.attrs[name] = value; },
};
engine.translateAttributes(el);
assert.strictEqual(el.attrs.title, '关闭');
el.attrs.title = 'Close';
engine.translateAttributes(el);
walkNodes = [el];
engine.revertSubtree(el);
assert.strictEqual(el.attrs.title, 'Close', 'attribute revert must use the refreshed original');

console.log('ENGINE_PROBE_OK');
`;

const { spawnSync } = require('node:child_process');
const os = require('node:os');
const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-i18n-probe-'));
const probePath = path.join(probeDir, 'probe.cjs');
fs.writeFileSync(probePath, engineProbeScript);
const probe = spawnSync(process.execPath, [probePath], { cwd: repoRoot, encoding: 'utf8' });
try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}
assert(probe.status === 0 && probe.stdout.includes('ENGINE_PROBE_OK'), `Engine probe failed (status ${probe.status}, ${probe.error}): ${probe.stderr}${probe.stdout}`);
console.log('PASS: Lossless restore, host-text refresh, and hot re-injection cleanup verified');

// 6. Benchmark performance of 10,000 translations
const testPhrases = [
  'New Conversation',
  'Conversation History',
  'Automations',
  'Customizations',
  'Projects',
  'Settings',
  'Thought for 5.2s',
  '3 files',
  'Regular user chat sentence that should not match at all'
];

const start = performance.now();
for (let i = 0; i < 10000; i++) {
  const p = testPhrases[i % testPhrases.length];
  testTranslate(p);
}
const elapsed = performance.now() - start;
assert(elapsed < 50, `10,000 translation lookups should take < 50ms (took ${elapsed.toFixed(2)}ms)`);
console.log(`PASS: High-performance translation lookup benchmark: 10,000 iterations in ${elapsed.toFixed(2)}ms`);

console.log('ALL Antigravity 2.0 UI Localization tests passed successfully!\n');
