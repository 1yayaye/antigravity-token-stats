/** Installs the built native host into a closed IDE, then launches its executable. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { findIdeDir } = require('./proxy-manager.cjs');
const { patchIde } = require('../hosts/antigravity-ide/scripts/patch-ide.cjs');

try {
  const port = process.env.ANTIGRAVITY_IDE_CDP_PORT;
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    throw new Error('ANTIGRAVITY_IDE_CDP_PORT must be a port number from 1 to 65535.');
  }
  const installDir = findIdeDir();
  if (!installDir) throw new Error('Antigravity IDE was not found. Set ANTIGRAVITY_IDE_DIR to its installation directory.');
  const result = patchIde({ installDir });
  const executable = path.join(result.installDir, 'Antigravity IDE.exe');
  const child = spawn(executable, port === undefined ? [] : [`--remote-debugging-port=${Number(port)}`], {
    shell: false,
    detached: true,
    stdio: 'ignore',
  });
  child.once('error', error => {
    console.error(`[TokenStats IDE] Could not launch IDE: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('spawn', () => {
    child.unref();
    console.log(`[TokenStats IDE] Launched ${executable}`);
  });
} catch (error) {
  console.error(`[TokenStats IDE] ${error.message}`);
  process.exitCode = 1;
}
