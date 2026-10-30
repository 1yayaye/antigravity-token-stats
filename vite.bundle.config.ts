import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { STYLE_ELEMENT_ID, WINDOW_API } from './src/injection-contract.cjs';

function inlineCssPlugin(): Plugin {
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

// One injectable UI bundle, one entry/output per host target. Selected by
// HOST_TARGET (default "antigravity", the desktop client); "antigravity-ide"
// builds the IDE webview extension bundle.
const HOST_TARGETS = {
  antigravity: {
    entry: 'hosts/antigravity/src/standalone.tsx',
    outDir: 'dist-bundle',
    fileName: 'antigravity-stats-bundle.js',
    // dist-bundle holds only build output; the IDE media dir also carries
    // checked-in extension assets, so it must not be emptied.
    emptyOutDir: true,
  },
  'antigravity-ide': {
    entry: 'hosts/antigravity-ide/src/webview/standalone.tsx',
    outDir: 'hosts/antigravity-ide/extension/media',
    fileName: 'antigravity-stats-ide-bundle.js',
    emptyOutDir: false,
  },
} as const;

const hostTarget = process.env.HOST_TARGET ?? 'antigravity';
const target = HOST_TARGETS[hostTarget as keyof typeof HOST_TARGETS];
if (!target) {
  throw new Error(
    `Unknown HOST_TARGET "${hostTarget}". Expected one of: ${Object.keys(HOST_TARGETS).join(', ')}.`,
  );
}

export default defineConfig({
  plugins: [react(), inlineCssPlugin()],
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
