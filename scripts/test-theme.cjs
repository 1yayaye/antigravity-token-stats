const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

console.log('--- Testing Theme Integration & Guardrails ---');

// 1. Verify CSS does not pollute host body/html and scopes all rules
const cssPath = path.join(__dirname, '../src/index.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

assert(!cssContent.includes(':root:not(.dark)'), 'CSS must NOT contain :root:not(.dark)');
assert(!cssContent.includes('html:not(.dark)'), 'CSS must NOT contain html:not(.dark)');
assert(!cssContent.includes('body.dark'), 'CSS must NOT target body.dark (pollutes Antigravity host)');
assert(!cssContent.includes('body.theme-dark'), 'CSS must NOT target body.theme-dark (pollutes Antigravity host)');
assert(!cssContent.includes('body.dark-theme'), 'CSS must NOT target body.dark-theme (pollutes Antigravity host)');
assert(!cssContent.includes('body.light'), 'CSS must NOT target body.light (pollutes Antigravity host)');
assert(!cssContent.includes('body.theme-light'), 'CSS must NOT target body.theme-light (pollutes Antigravity host)');
assert(!cssContent.includes('html.dark'), 'CSS must NOT target html.dark');
assert(!cssContent.includes('html.light'), 'CSS must NOT target html.light');
assert(!/(^|\n)\s*::-webkit-scrollbar/m.test(cssContent), 'CSS must NOT contain un-scoped global ::-webkit-scrollbar');
assert(cssContent.includes('.antigravity-stats-container.dark') || cssContent.includes('.stats-view.dark'), 'CSS must support .dark container');
assert(cssContent.includes('.antigravity-stats-container.light') || cssContent.includes('.stats-view.light'), 'CSS must support .light container');
console.log('PASS: index.css strictly isolates theme styles within stats containers without polluting Antigravity host');

// 2. Test detectAntigravityTheme logic via stats-service
const filename = path.join(__dirname, '../src/services/stats-service.ts');
const service = new Module(filename, module);
service._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

const { detectAntigravityTheme, syncThemeToElement } = service.exports;

// Mock DOM environment for testing
const originalDoc = global.document;
const originalWindow = global.window;

// Scenario A: Antigravity dark mode (classes on body)
global.document = {
  documentElement: { classList: { contains: (cls) => false }, getAttribute: () => null },
  body: {
    classList: {
      contains: (cls) => ['theme-standalone', 'dark', 'theme-dark', 'dark-theme'].includes(cls),
    },
    getAttribute: () => null,
  },
};
global.window = {
  getComputedStyle: () => ({ backgroundColor: 'rgb(16, 16, 16)' }),
  matchMedia: () => ({ matches: false }),
};

assert.equal(detectAntigravityTheme(), 'dark', 'Should detect dark mode when Antigravity body has dark classes');

// Scenario B: Antigravity light mode
global.document = {
  documentElement: { classList: { contains: (cls) => false }, getAttribute: () => null },
  body: {
    classList: {
      contains: (cls) => ['theme-standalone', 'light', 'theme-light', 'light-theme'].includes(cls),
    },
    getAttribute: () => null,
  },
};
global.window = {
  getComputedStyle: () => ({ backgroundColor: 'rgb(250, 250, 250)' }),
  matchMedia: () => ({ matches: false }),
};

assert.equal(detectAntigravityTheme(), 'light', 'Should detect light mode when Antigravity body has light classes');

// Scenario C: Preview mode (class on documentElement)
global.document = {
  documentElement: { classList: { contains: (cls) => cls === 'dark' }, getAttribute: () => null },
  body: { classList: { contains: () => false }, getAttribute: () => null },
};
global.window = {
  getComputedStyle: () => ({ backgroundColor: '' }),
  matchMedia: () => ({ matches: false }),
};

assert.equal(detectAntigravityTheme(), 'dark', 'Should detect dark mode when documentElement has dark class');

// Scenario E: Unmarked host defaults to dark
global.document = {
  documentElement: { classList: { contains: () => false }, getAttribute: () => null },
  body: { classList: { contains: () => false }, getAttribute: () => null },
};
global.window = {
  getComputedStyle: () => ({ backgroundColor: 'rgb(255, 255, 255)' }),
  matchMedia: () => ({ matches: false }),
};
assert.equal(detectAntigravityTheme(), 'dark', 'Unmarked host should default to dark');

// Scenario F: Real Antigravity Light mode ('theme-standalone theme-light' on body)
global.document = {
  documentElement: { classList: { contains: () => false }, getAttribute: () => null },
  body: {
    classList: {
      contains: (cls) => ['theme-standalone', 'theme-light'].includes(cls),
    },
    getAttribute: () => null,
  },
};
global.window = {
  getComputedStyle: () => ({ backgroundColor: 'rgb(248, 250, 252)' }),
  matchMedia: () => ({ matches: false }),
};
assert.equal(detectAntigravityTheme(), 'light', 'Should detect light mode when Antigravity body has theme-light');

// Scenario D: Test syncThemeToElement
const mockEl = {
  classes: new Set(),
  classList: {
    add(cls) { mockEl.classes.add(cls); },
    remove(cls) { mockEl.classes.delete(cls); },
    contains(cls) { return mockEl.classes.has(cls); },
  },
};
syncThemeToElement(mockEl);
assert(mockEl.classList.contains('light'), 'syncThemeToElement should add light class when theme is light');
assert(!mockEl.classList.contains('dark'), 'syncThemeToElement should remove dark class when theme is light');

// Cleanup mocks
global.document = originalDoc;
global.window = originalWindow;

console.log('PASS: detectAntigravityTheme and syncThemeToElement handle all host contexts accurately');
console.log('ALL Theme integration tests passed successfully!\n');
