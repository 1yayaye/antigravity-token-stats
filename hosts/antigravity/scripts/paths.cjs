/**
 * Desktop (Antigravity 桌面端) filesystem facts — the single source for locating the
 * Antigravity installation, its DevTools port file, and this project's per-machine
 * state directory. Consumed by patch/unpatch/loader and the real-device CDP scripts.
 *
 * install.ps1 is PowerShell and cannot require this module; its embedded copy of the
 * install-dir logic is a documented duplicate.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function getLocalAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

function getAntigravityResourcesDir() {
  if (process.env.ANTIGRAVITY_RESOURCES && fs.existsSync(process.env.ANTIGRAVITY_RESOURCES)) {
    return process.env.ANTIGRAVITY_RESOURCES;
  }

  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'resources'),
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Antigravity', 'resources') : null,
    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Antigravity', 'resources') : null,
    'C:\\Program Files\\Antigravity\\resources',
    'C:\\Program Files (x86)\\Antigravity\\resources'
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'resources');
}

function findAntigravityExe() {
  if (process.env.ANTIGRAVITY_EXE && fs.existsSync(process.env.ANTIGRAVITY_EXE)) {
    return process.env.ANTIGRAVITY_EXE;
  }
  const resDir = getAntigravityResourcesDir();
  const exeInParent = path.join(path.dirname(resDir), 'Antigravity.exe');
  if (fs.existsSync(exeInParent)) return exeInParent;
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'Antigravity.exe') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe'),
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Antigravity', 'Antigravity.exe') : null,
    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Antigravity', 'Antigravity.exe') : null
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Antigravity.exe not found');
}

function isAntigravityRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return out.toLowerCase().includes('antigravity.exe');
  } catch {
    return false;
  }
}

// Per-machine state owned by this project (dev-bundle redirect, stats cache).
function getStateDir() {
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'AntiToken');
  return path.join(os.homedir(), '.antigravity-token-stats');
}

function getDevBundlePathFile() {
  return path.join(getStateDir(), 'dev-bundle.path');
}

// Reads the live CDP port of the running Antigravity instance. Honors
// ANTIGRAVITY_DEVTOOLS_PORT / ANTIGRAVITY_DEVTOOLS_PATH overrides.
function findDevToolsPort() {
  if (process.env.ANTIGRAVITY_DEVTOOLS_PORT) return parseInt(process.env.ANTIGRAVITY_DEVTOOLS_PORT, 10);
  const candidates = [
    process.env.ANTIGRAVITY_DEVTOOLS_PATH,
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort'),
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'antigravity', 'DevToolsActivePort'),
    path.join(getLocalAppData(), 'Programs', 'antigravity', 'DevToolsActivePort'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'DevToolsActivePort'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const port = parseInt(fs.readFileSync(candidate, 'utf8').split('\n')[0].trim(), 10);
      if (port) return port;
    }
  }
  throw new Error('DevToolsActivePort not found');
}

function getProxyDllPath() {
  const exe = findAntigravityExe();
  return path.join(path.dirname(exe), 'version.dll');
}

function getProxyConfigPath() {
  const exe = findAntigravityExe();
  return path.join(path.dirname(exe), 'config.json');
}

function isProxyInstalled() {
  try {
    return fs.existsSync(getProxyDllPath()) && fs.existsSync(getProxyConfigPath());
  } catch {
    return false;
  }
}

module.exports = {
  getLocalAppData,
  getAntigravityResourcesDir,
  findAntigravityExe,
  isAntigravityRunning,
  getStateDir,
  getDevBundlePathFile,
  findDevToolsPort,
  getProxyDllPath,
  getProxyConfigPath,
  isProxyInstalled,
};
