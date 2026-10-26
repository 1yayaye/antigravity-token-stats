#!/usr/bin/env node
/**
 * Creates Windows Shortcuts for Antigravity (with Stats)
 * Places "Antigravity (with Stats).lnk" on Desktop and Start Menu,
 * pointing directly to Antigravity.exe.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const child_process = require('node:child_process');

function getPowerShellCmd() {
  try {
    child_process.execFileSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { stdio: 'ignore' });
    return 'pwsh';
  } catch {
    return 'powershell.exe';
  }
}

function findAntigravityExe() {
  const candidates = [
    process.env.ANTIGRAVITY_EXE,
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'antigravity', 'Antigravity.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Antigravity', 'Antigravity.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Antigravity', 'Antigravity.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Antigravity.exe was not found in standard installation directories:\n` +
    candidates.map(c => `  - ${c}`).join('\n') +
    `\nPlease set the ANTIGRAVITY_EXE environment variable to your Antigravity.exe path.`
  );
}

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

  const psCmd = getPowerShellCmd();
  const encoded = Buffer.from(psLines, 'utf16le').toString('base64');
  child_process.execFileSync(psCmd, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdio: 'pipe',
    encoding: 'utf8'
  });
}

function getDesktopDir() {
  const psCmd = getPowerShellCmd();
  try {
    const out = child_process.execFileSync(psCmd, ['-NoProfile', '-NonInteractive', '-Command', '[System.Environment]::GetFolderPath("Desktop")'], { encoding: 'utf8' }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return path.join(os.homedir(), 'Desktop');
}

function getStartMenuDir() {
  const psCmd = getPowerShellCmd();
  try {
    const out = child_process.execFileSync(psCmd, ['-NoProfile', '-NonInteractive', '-Command', '[System.Environment]::GetFolderPath("Programs")'], { encoding: 'utf8' }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

function setupShortcut() {
  console.log('\n======================================================');
  console.log('📌 Setting up Antigravity (with Stats) Shortcut');
  console.log('======================================================\n');

  if (process.platform !== 'win32') {
    console.log('[Notice] Shortcut creation via .lnk is currently for Windows. On Linux/macOS, launch Antigravity directly.');
    return;
  }

  let exePath = '';
  try {
    exePath = findAntigravityExe();
    console.log(`[Target] Found Antigravity executable: ${exePath}`);
  } catch (err) {
    console.warn(`[Warning] ${err.message}`);
    return;
  }

  const workingDir = path.dirname(exePath);
  const shortcutName = 'Antigravity (with Stats).lnk';

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
          exePath,
          '',
          workingDir,
          exePath,
          'Launch Antigravity 2.0 (with Token Stats)'
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
    console.log('✓ SUCCESS: Desktop and Start Menu shortcuts created!');
    console.log('  They point directly to Antigravity.exe with native Stats.');
    console.log('======================================================\n');
  } else {
    console.warn('\n[Notice] Could not find Desktop or Start Menu directory to place shortcut.');
  }
}

if (require.main === module) {
  setupShortcut();
}

module.exports = {
  findAntigravityExe,
  createShortcutWindows,
  setupShortcut,
  getPowerShellCmd
};
