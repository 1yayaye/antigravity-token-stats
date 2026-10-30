/**
 * Launches the Antigravity IDE as an extension-development host pointed at
 * hosts/antigravity-ide/extension. Run the bundle and extension builds first
 * (`npm run dev:ide` chains them); the launch itself is fire-and-forget.
 *
 * The IDE install location is machine-specific and never hard-coded here: set
 * ANTIGRAVITY_IDE_CMD to the launcher (e.g. "D:/Programs/Antigravity IDE/bin/
 * antigravity-ide.cmd"), optionally in .zcode env or your shell profile.
 */
const { spawn } = require('child_process');
const path = require('path');

const IDE_CMD = process.env.ANTIGRAVITY_IDE_CMD;
const extensionDir = path.join(__dirname, '..', 'hosts', 'antigravity-ide', 'extension');

if (!IDE_CMD) {
  console.error(
    '[TokenStats IDE] ANTIGRAVITY_IDE_CMD is not set. Point it at the Antigravity IDE launcher,\n' +
    'e.g. set ANTIGRAVITY_IDE_CMD=D:/Programs/Antigravity IDE/bin/antigravity-ide.cmd'
  );
  process.exitCode = 1;
} else if (!require('fs').existsSync(IDE_CMD)) {
  console.error(`[TokenStats IDE] IDE launcher not found: ${IDE_CMD}`);
  process.exitCode = 1;
} else {
  // No cmd `start` wrapper: detached:true already detaches, and `start`
  // silently no-ops on forward-slash paths, hiding launcher failures.
  // Args are quoted because the install path and the extension path may
  // contain spaces.
  // ANTIGRAVITY_IDE_CDP_PORT (optional): expose a CDP endpoint on the IDE so
  // hosts/antigravity-ide/scripts can drive acceptance checks against it.
  const cdpArgs = process.env.ANTIGRAVITY_IDE_CDP_PORT
    ? ` --remote-debugging-port=${process.env.ANTIGRAVITY_IDE_CDP_PORT}`
    : '';
  spawn(`"${IDE_CMD}" --extensionDevelopmentPath="${extensionDir}"${cdpArgs}`, {
    shell: true,
    detached: true,
    stdio: 'ignore',
  }).unref();
  console.log(`[TokenStats IDE] Launching extension dev host for ${extensionDir}${cdpArgs}`);
}
