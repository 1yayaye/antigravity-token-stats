#!/usr/bin/env node
/**
 * Smart Launcher for Antigravity 2.0 with Token Stats
 * 
 * Flow:
 * 1. Checks if Antigravity is already running with active DevTools.
 * 2. If not running, locates Antigravity.exe and launches it detached.
 * 3. Polls for DevToolsActivePort until responsive (up to 15s).
 * 4. Hot-injects Token Stats bundle & displays Glassmorphism Toast.
 * 5. Spawns a detached inject:watch process for live updates.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');
const { inject, getDevToolsPort } = require('./inject-live.cjs');

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

async function isDevToolsReady(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    const pages = await res.json();
    return pages.some(p => p.type === 'page' && !p.url.includes('devtools://') && p.url !== 'about:blank' && (p.url.startsWith('http') || p.url.startsWith('file')));
  } catch {
    return false;
  }
}

async function waitForDevTools(timeoutMs = 20000) {
  const startTime = Date.now();
  const pollInterval = 500;

  process.stdout.write('[Launcher] Waiting for Antigravity window & DevTools...');
  while (Date.now() - startTime < timeoutMs) {
    try {
      const port = await getDevToolsPort();
      if (await isDevToolsReady(port)) {
        process.stdout.write(' Ready!\n');
        return port;
      }
    } catch {
      // DevToolsActivePort file not present or not ready yet
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, pollInterval));
  }

  process.stdout.write('\n');
  throw new Error(`Timed out waiting for Antigravity DevTools to become active (${timeoutMs / 1000}s).`);
}

function logToFile(msg) {
  try {
    const logDir = path.join(os.homedir(), '.gemini', 'antigravity');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'launcher.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  logToFile(`[UncaughtException]: ${err.stack || err.message}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logToFile(`[UnhandledRejection]: ${reason?.stack || reason}`);
  process.exit(1);
});

function focusAntigravityWindow() {
  if (process.platform !== 'win32') return;
  try {
    const ps = `
      $sig = @'
      [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
      [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
      [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
'@
      $type = Add-Type -MemberDefinition $sig -Name Win32Focus -Namespace Win32 -PassThru
      $pids = (Get-Process Antigravity -ErrorAction SilentlyContinue).Id
      if ($pids) {
        [Win32.Win32Focus]::EnumWindows({
          param($h, $l)
          $p = 0
          [Win32.Win32Focus]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
          if ($pids -contains $p -and [Win32.Win32Focus]::IsWindowVisible($h)) {
            [Win32.Win32Focus]::ShowWindowAsync($h, 9) | Out-Null
            [Win32.Win32Focus]::SetForegroundWindow($h) | Out-Null
          }
          return [bool]$true
        }, [IntPtr]::Zero) | Out-Null
      }
    `;
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    child_process.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { stdio: 'ignore' });
  } catch (e) {}
}

function killLegacyDaemon() {
  const pidFile = path.join(os.homedir(), '.gemini', 'antigravity', 'token-stats-' + 'daemon.pid');
  try {
    if (!fs.existsSync(pidFile)) return;
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0) {
      if (process.platform === 'win32') {
        try {
          child_process.execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'ignore', windowsHide: true, timeout: 5000,
          });
        } catch {}
      } else {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }
    }
    fs.unlinkSync(pidFile);
  } catch {}
}

async function launch() {
  console.log('\n======================================================');
  console.log('🚀 Launching Antigravity 2.0 with Token Stats');
  console.log('======================================================\n');
  logToFile('Launcher invoked.');
  killLegacyDaemon();

  // Step 1: Check if already running
  let port = null;
  let alreadyRunning = false;
  try {
    port = await getDevToolsPort();
    alreadyRunning = await isDevToolsReady(port);
  } catch {
    alreadyRunning = false;
  }

  if (alreadyRunning) {
    console.log(`[Launcher] Antigravity is already running (DevTools port: ${port}).`);
    logToFile(`Antigravity is already running on port ${port}.`);
  } else {
    // Step 2: Locate and launch Antigravity.exe
    const exePath = findAntigravityExe();
    const userArgs = process.argv.slice(2);
    console.log(`[Launcher] Starting Antigravity: ${exePath}${userArgs.length ? ' ' + userArgs.join(' ') : ''}`);
    logToFile(`Spawning Antigravity: ${exePath}`);
    const child = child_process.spawn(exePath, userArgs, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // Step 3: Wait for DevTools port
    port = await waitForDevTools(20000);
    logToFile(`Antigravity DevTools ready on port ${port}.`);
  }

  // Step 4: Perform Pure CDP Hot Injection & Open Modal
  console.log('[Launcher] Injecting Token Stats via CDP & activating modal...');
  logToFile('Starting CDP inject...');
  await inject({ port, silent: false, openModal: true });
  logToFile('CDP inject finished.');

  // Focus Antigravity window
  logToFile('Focusing Antigravity window...');
  focusAntigravityWindow();
  logToFile('Injection and focus completed successfully.');

  // Step 5: Start background real-time sync watch
  spawnWatch();

  console.log('\n[Launcher] Done! Launcher exited cleanly with real-time sync active.');
}

function spawnWatch() {
  const scriptPath = path.join(__dirname, 'inject-live.cjs');
  const projectRoot = path.join(__dirname, '..');
  const child = child_process.spawn(
    process.execPath,
    [scriptPath, '--watch'],
    {
      detached: true,
      stdio: 'ignore',
      cwd: projectRoot,
      windowsHide: true,
    }
  );
  child.unref();
}

if (require.main === module) {
  launch()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      const errMsg = err.stack || err.message || String(err);
      console.error('\n[Launcher Error]:', errMsg);
      logToFile(`[Launcher Error]: ${errMsg}`);
      try {
        if (process.platform === 'win32') {
          const alertPs = `[System.Windows.Forms.MessageBox]::Show('Antigravity (with Stats) 启动失败:\n${errMsg.replace(/'/g, "''")}', 'Token Stats Launcher', 0, 16)`;
          child_process.spawn('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; ${alertPs}`], { detached: true, stdio: 'ignore' });
        }
      } catch (e) {}
      process.exit(1);
    });
}

module.exports = {
  findAntigravityExe,
  isDevToolsReady,
  waitForDevTools,
  launch,
  focusAntigravityWindow,
  spawnWatch,
};
