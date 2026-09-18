import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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
    var prev = document.getElementById('antigravity-stats-styles');
    if (prev) {
      console.log('[AntigravityStats] Replacing existing styles version:', prev.getAttribute('data-version') || 'unknown');
      prev.remove();
    }
    var style = document.createElement('style');
    style.id = 'antigravity-stats-styles';
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

export default defineConfig({
  plugins: [react(), inlineCssPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-bundle',
    emptyOutDir: true,
    lib: {
      entry: 'src/standalone.tsx',
      name: 'AntigravityStats',
      formats: ['iife'],
      fileName: () => 'antigravity-stats-bundle.js',
    },
    cssCodeSplit: false,
  },
});
