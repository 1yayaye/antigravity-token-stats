#!/usr/bin/env node
/**
 * Creates Windows Shortcuts for Antigravity (with Stats)
 * Places "Antigravity (with Stats).lnk" on Desktop and/or Start Menu.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');
const { findAntigravityExe } = require('./launch-antigravity.cjs');

function createShortcutWindows(shortcutPath, targetPath, scriptArg, workingDir, iconPath, description) {
  const psLines = [
    '$WshShell = New-Object -ComObject WScript.Shell',
    `$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
    `$Shortcut.TargetPath = '${targetPath.replace(/'/g, "''")}'`,
    scriptArg ? `$Shortcut.Arguments = '${scriptArg.replace(/'/g, "''")}'` : '',
    `$Shortcut.WorkingDirectory = '${workingDir.replace(/'/g, "''")}'`,
    iconPath ? `$Shortcut.IconLocation = '${iconPath.replace(/'/g, "''")},0'` : '',
    `$Shortcut.Description = '${description.replace(/'/g, "''")}'`,
    '$Shortcut.WindowStyle = 1',
    '$Shortcut.Save()'
  ].filter(Boolean).join('\r\n');

  const encoded = Buffer.from(psLines, 'utf16le').toString('base64');
  child_process.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdio: 'pipe',
    encoding: 'utf8'
  });
}

function getDesktopDir() {
  try {
    const out = child_process.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Environment]::GetFolderPath("Desktop")'], { encoding: 'utf8' }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return path.join(os.homedir(), 'Desktop');
}

function getStartMenuDir() {
  try {
    const out = child_process.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Environment]::GetFolderPath("Programs")'], { encoding: 'utf8' }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

function setupShortcut() {
  console.log('\n======================================================');
  console.log('📌 Setting up Antigravity (with Stats) Shortcut');
  console.log('======================================================\n');

  if (process.platform !== 'win32') {
    console.log('[Notice] Shortcut creation via .lnk is currently for Windows. On Linux/macOS, use "npm run launch".');
    return;
  }

  let exePath = '';
  try {
    exePath = findAntigravityExe();
    console.log(`[Icon Source] Found Antigravity executable: ${exePath}`);
  } catch (err) {
    console.warn(`[Warning] ${err.message}. Using default icon.`);
  }

  const launcherScript = path.resolve(__dirname, 'launch-antigravity.cjs');
  const projectRoot = path.resolve(__dirname, '..');
  const nodeExe = process.execPath;
  const shortcutName = 'Antigravity (with Stats).lnk';

  const targetPath = nodeExe;
  const targetArgs = `"${launcherScript}"`;

  const locations = [
    { name: 'Desktop', dir: getDesktopDir() },
    { name: 'Start Menu', dir: getStartMenuDir() }
  ];

  let createdCount = 0;
  for (const loc of locations) {
    if (fs.existsSync(loc.dir)) {
      const shortcutPath = path.join(loc.dir, shortcutName);
      try {
        createShortcutWindows(
          shortcutPath,
          targetPath,
          targetArgs,
          projectRoot,
          exePath,
          'Launch Antigravity 2.0 with Token Stats'
        );
        console.log(`✓ Created shortcut in ${loc.name}: ${shortcutPath}`);
        createdCount++;
      } catch (err) {
        console.error(`❌ Failed to create shortcut in ${loc.name}:`, err.message);
      }
    }
  }

  if (createdCount > 0) {
    console.log('\n======================================================');
    console.log('✓ SUCCESS: You can now launch Antigravity directly from');
    console.log('  your Desktop or Start Menu with Token Stats pre-injected!');
    console.log('======================================================\n');
  } else {
    console.warn('\n[Notice] Could not find Desktop or Start Menu directory to place shortcut.');
  }
}

if (require.main === module) {
  setupShortcut();
}

module.exports = {
  createShortcutWindows,
  setupShortcut
};
