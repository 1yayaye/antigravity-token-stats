#!/usr/bin/env node
/**
 * Antigravity Local Process Proxy Manager
 *
 * Manages local socket proxy forwarding (version.dll + config.json)
 * for both Google Antigravity Desktop (Electron) and Antigravity IDE.
 *
 * Features:
 * - Discovers Desktop and IDE installation paths automatically.
 * - Safely installs and uninstalls version.dll + config.json with EBUSY process guards.
 * - Generates tuned config.json supporting SOCKS5 and HTTP protocols with loopback TLS bypass.
 * - Tests proxy connectivity, SOCKS5/HTTP handshakes, and Google API tunnel reachability.
 * - Diagnoses IP egress, datacenter flags, and scans Antigravity logs for location restrictions.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');

// Load path resolver from desktop host if available
let desktopPaths;
try {
  desktopPaths = require('./paths.cjs');
} catch {
  try {
    desktopPaths = require('../hosts/antigravity/scripts/paths.cjs');
  } catch {
    desktopPaths = null;
  }
}

function getLocalAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

function getAppData() {
  return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

const runningCache = new Map();
const runningInFlight = new Set();

function refreshProcessStatusAsync(processName) {
  if (runningInFlight.has(processName)) return;
  runningInFlight.add(processName);
  const lower = processName.toLowerCase();
  execFile('tasklist', ['/FI', `IMAGENAME eq ${processName}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  }, (err, stdout) => {
    runningInFlight.delete(processName);
    if (err) return;
    runningCache.set(processName, {
      result: String(stdout || '').toLowerCase().includes(lower),
      ts: Date.now(),
    });
  });
}

function isProcessRunning(processName, maxAgeMs = 5000, options = {}) {
  if (process.platform !== 'win32') return false;
  const lower = processName.toLowerCase();
  // Fast path: if checking Antigravity.exe while running inside Electron host
  if (lower === 'antigravity.exe' && (process.versions?.electron || process.type)) {
    return true;
  }
  // Fast path: if checking Antigravity IDE while running in VSCode extension host
  if (lower === 'antigravity ide.exe' && (process.env.VSCODE_PID || process.env.ANTIGRAVITY_IDE_PID)) {
    return true;
  }
  const now = Date.now();
  const cached = runningCache.get(processName);
  if (cached && now - cached.ts < maxAgeMs) {
    return cached.result;
  }
  if (options.nonBlocking) {
    refreshProcessStatusAsync(processName);
    return cached ? cached.result : false;
  }
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${processName}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const result = out.toLowerCase().includes(lower);
    runningCache.set(processName, { result, ts: now });
    return result;
  } catch {
    return false;
  }
}

function killProcess(processName) {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('taskkill', ['/F', '/IM', processName], { stdio: 'ignore' });
  } catch {}
}

/**
 * Locate Antigravity Desktop directory containing Antigravity.exe
 */
function findDesktopDir() {
  if (desktopPaths) {
    try {
      const exe = desktopPaths.findAntigravityExe();
      if (fs.existsSync(exe)) return path.dirname(exe);
    } catch {}
  }

  const candidates = [
    process.env.ANTIGRAVITY_DIR,
    path.join(getLocalAppData(), 'Programs', 'antigravity'),
    path.join(getLocalAppData(), 'Programs', 'Antigravity'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Antigravity'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Antigravity'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'Antigravity.exe'))) {
      return dir;
    }
  }
  return null;
}

/**
 * Locate Antigravity IDE directory containing "Antigravity IDE.exe"
 */
function findIdeDir() {
  // Check explicit environment variables
  if (process.env.ANTIGRAVITY_IDE_DIR && fs.existsSync(path.join(process.env.ANTIGRAVITY_IDE_DIR, 'Antigravity IDE.exe'))) {
    return process.env.ANTIGRAVITY_IDE_DIR;
  }

  if (process.env.ANTIGRAVITY_IDE_CMD) {
    const cmdPath = process.env.ANTIGRAVITY_IDE_CMD;
    const parentDir = path.dirname(cmdPath);
    if (fs.existsSync(path.join(parentDir, 'Antigravity IDE.exe'))) {
      return parentDir;
    }
    const grandParentDir = path.resolve(parentDir, '..');
    if (fs.existsSync(path.join(grandParentDir, 'Antigravity IDE.exe'))) {
      return grandParentDir;
    }
  }

  const candidates = [
    path.join(getLocalAppData(), 'Programs', 'Antigravity IDE'),
    path.join(getLocalAppData(), 'Programs', 'antigravity-ide'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Antigravity IDE'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Antigravity IDE'),
  ];

  // Dynamic search across common Windows drive letters (e.g. C:\Programs\..., D:\Programs\...)
  for (const drive of ['C', 'D', 'E', 'F']) {
    candidates.push(`${drive}:\\Programs\\Antigravity IDE`);
  }

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'Antigravity IDE.exe'))) {
      return dir;
    }
  }
  return null;
}

/**
 * Locate vendor version.dll binary
 */
function getVendorDllPath() {
  const candidates = [
    path.resolve(__dirname, '..', 'vendor', 'proxy', 'win-x64', 'version.dll'),
    path.resolve(__dirname, 'vendor', 'proxy', 'win-x64', 'version.dll'),
    path.resolve(__dirname, '..', '..', '..', '..', 'vendor', 'proxy', 'win-x64', 'version.dll'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Build standard config.json structure for local process proxy
 */
function buildConfig(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port) || 7890;
  const type = options.type === 'http' ? 'http' : 'socks5';

  return {
    _managed_by: 'antigravity-token-stats',
    _version: '2.6.3',
    log_level: options.logLevel || 'info',
    traffic_logging: Boolean(options.trafficLogging),
    ui: {
      load_notify: options.loadNotify || 'none',
    },
    proxy: {
      type,
      host,
      port,
    },
    fake_ip: {
      cidr: '198.18.0.0/15',
      enabled: options.fakeIp !== false,
    },
    timeout: {
      connect: 5000,
      recv: 5000,
      send: 5000,
    },
    diagnostics: {
      agent_ip_probe: Boolean(options.agentIpProbe),
    },
    child_injection: true,
    child_injection_mode: 'filtered',
    child_injection_exclude: [],
    target_processes: [
      'agy.exe',
      'language_server.exe',
      'language_server_windows_x64.exe',
      'language_server_windows',
      'Antigravity.exe',
      'Antigravity IDE.exe',
      'node.exe',
    ],
    proxy_rules: {
      routing: {
        default_action: 'proxy',
        priority_mode: 'order',
        rules: [],
        use_default_private: true,
        enabled: true,
      },
      allowed_ports: [80, 443],
      udp_mode: 'auto',
      ipv6_mode: 'proxy',
      udp_fallback: 'block',
      dns_mode: 'direct',
    },
    updates: {
      enabled: false,
    },
  };
}

function sha256FileSync(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeFileAtomic(filePath, content) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmpPath, content, typeof content === 'string' ? 'utf8' : undefined);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

function copyFileAtomicWithSha256(srcPath, dstPath) {
  const expectedHash = sha256FileSync(srcPath);
  const tmpPath = `${dstPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  try {
    fs.copyFileSync(srcPath, tmpPath);
    if (sha256FileSync(tmpPath) !== expectedHash) {
      throw new Error(`SHA256 verification failed after copying ${path.basename(srcPath)}`);
    }
    fs.renameSync(tmpPath, dstPath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

// Strip // and /* */ comments outside string literals plus trailing commas (JSONC-tolerant).
function parseJsonTolerant(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  const cleaned = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(cleaned);
}

function mergeConfigWithExisting(targetConfigPath, options = {}) {
  if (!options.overwriteConfig && fs.existsSync(targetConfigPath)) {
    try {
      const existing = parseJsonTolerant(fs.readFileSync(targetConfigPath, 'utf8'));
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        const host = options.host || existing.proxy?.host || '127.0.0.1';
        const port = Number(options.port) || Number(existing.proxy?.port) || 7890;
        const type = options.type === 'http'
          ? 'http'
          : (options.type === 'socks5' ? 'socks5' : (existing.proxy?.type === 'http' ? 'http' : 'socks5'));
        const existingProxy = existing.proxy && typeof existing.proxy === 'object' && !Array.isArray(existing.proxy)
          ? existing.proxy
          : {};
        return {
          ...existing,
          _managed_by: 'antigravity-token-stats',
          _version: '2.6.3',
          proxy: {
            ...existingProxy,
            type,
            host,
            port,
          },
        };
      }
    } catch {}
  }
  return buildConfig(options);
}

function hasProxyLogFiles(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return false;
  try {
    return fs.readdirSync(dirPath).some(
      (f) => f === 'proxy.log' || f === 'proxy.log.1' || (f.startsWith('proxy-') && f.endsWith('.log'))
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the active proxy log directory for an installation directory.
 */
function resolveProxyLogDir(targetDir, installed = false) {
  const appLogDir = targetDir ? path.join(targetDir, 'logs') : null;
  if (hasProxyLogFiles(appLogDir)) return appLogDir;
  const tempLogDir = path.join(os.tmpdir(), 'antigravity-proxy-logs');
  if (hasProxyLogFiles(tempLogDir) || fs.existsSync(tempLogDir)) return tempLogDir;
  return installed ? tempLogDir : null;
}

/**
 * Read current proxy status for Desktop and IDE targets
 */
function getTargetStatus(target, customDir, options = {}) {
  if (target !== 'desktop' && target !== 'ide') {
    throw new Error(`Unknown target "${target}". Expected "desktop" or "ide".`);
  }
  const isDesktop = target === 'desktop';
  const dir = customDir || (isDesktop ? findDesktopDir() : findIdeDir());
  const exeName = isDesktop ? 'Antigravity.exe' : 'Antigravity IDE.exe';

  if (!dir) {
    return {
      target,
      installed: false,
      available: false,
      dir: null,
      exeExists: false,
      isRunning: false,
      dllExists: false,
      configExists: false,
      config: null,
      logDir: null,
    };
  }

  const dllPath = path.join(dir, 'version.dll');
  const configPath = path.join(dir, 'config.json');
  const dllExists = fs.existsSync(dllPath);
  const configExists = fs.existsSync(configPath);
  const isRunning = isProcessRunning(exeName, 5000, options);
  const isInsideTargetHost = isDesktop
    ? Boolean(process.versions?.electron || process.type)
    : Boolean(process.env.VSCODE_PID || process.env.ANTIGRAVITY_IDE_PID);
  const dllLoaded = dllExists && isInsideTargetHost ? isDllLoadedInProcess(dllPath) : null;

  let config = null;
  if (configExists) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
  }

  const installed = dllExists && configExists;
  return {
    target,
    installed,
    available: true,
    dir,
    exeExists: true,
    isRunning,
    dllExists,
    configExists,
    dllLoaded,
    config,
    logDir: resolveProxyLogDir(dir, installed),
  };
}

/**
 * Get comprehensive status for all supported targets
 */
function getAllStatus(options = {}) {
  const desktop = getTargetStatus('desktop', undefined, options);
  const ide = getTargetStatus('ide', undefined, options);
  return {
    desktop,
    ide,
    logDir: desktop.logDir || ide.logDir || null,
  };
}

/**
 * Install proxy DLL and configuration to a specific target
 */
function installProxy(target, options = {}) {
  if (target !== 'desktop' && target !== 'ide') {
    throw new Error(`Unknown target "${target}". Expected "desktop" or "ide".`);
  }
  const isDesktop = target === 'desktop';
  const dir = options.dir || (isDesktop ? findDesktopDir() : findIdeDir());
  const exeName = isDesktop ? 'Antigravity.exe' : 'Antigravity IDE.exe';

  if (!dir) {
    throw new Error(`Target ${target} (${exeName}) directory not found on system.`);
  }

  const running = isProcessRunning(exeName);
  if (!options.skipProcessCheck && running) {
    if (options.forceKill) {
      killProcess(exeName);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }

  const vendorDll = getVendorDllPath();
  if (!vendorDll) {
    throw new Error('Proxy binary (version.dll) not found in vendor directory.');
  }

  const targetDll = path.join(dir, 'version.dll');
  const targetConfig = path.join(dir, 'config.json');

  // Check if version.dll already exists and matches the vendor DLL by SHA256.
  // If identical, we don't need to overwrite it, avoiding Windows EBUSY locking
  // even while the application is active.
  let needsDllCopy = true;
  if (fs.existsSync(targetDll)) {
    try {
      if (sha256FileSync(vendorDll) === sha256FileSync(targetDll)) {
        needsDllCopy = false;
      }
    } catch {}
  }

  if (needsDllCopy) {
    if (!options.skipProcessCheck && isProcessRunning(exeName) && !options.forceKill) {
      throw new Error(`Cannot install proxy: ${exeName} is currently running. Close the application first or pass --force.`);
    }
    try {
      copyFileAtomicWithSha256(vendorDll, targetDll);
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        throw new Error(`Cannot update version.dll: ${exeName} is currently locking the file. Close the application and retry.`);
      }
      throw err;
    }
  }

  // Merge with existing config.json (preserving custom rules/settings) or generate baseline, then write atomically.
  const config = mergeConfigWithExisting(targetConfig, options);
  writeFileAtomic(targetConfig, `${JSON.stringify(config, null, 2)}\n`);

  return {
    target,
    dir,
    success: true,
    config,
  };
}

/**
 * Uninstall proxy DLL and configuration from a specific target
 */
function uninstallProxy(target, options = {}) {
  if (target !== 'desktop' && target !== 'ide') {
    throw new Error(`Unknown target "${target}". Expected "desktop" or "ide".`);
  }
  const isDesktop = target === 'desktop';
  const dir = options.dir || (isDesktop ? findDesktopDir() : findIdeDir());
  const exeName = isDesktop ? 'Antigravity.exe' : 'Antigravity IDE.exe';

  if (!dir) {
    return { target, success: false, reason: 'Target directory not found' };
  }

  if (!options.skipProcessCheck && isProcessRunning(exeName)) {
    if (options.forceKill) {
      killProcess(exeName);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    } else {
      throw new Error(`Cannot uninstall proxy: ${exeName} is currently running. Close the application first or pass --force.`);
    }
  }

  const targetDll = path.join(dir, 'version.dll');
  const targetConfig = path.join(dir, 'config.json');

  if (fs.existsSync(targetDll)) {
    try {
      fs.rmSync(targetDll, { force: true });
    } catch (err) {
      if (err.code === 'EBUSY') {
        throw new Error(`Cannot remove version.dll: ${exeName} is currently locking the file. Close the application and retry.`);
      }
      throw err;
    }
  }
  if (fs.existsSync(targetConfig)) {
    fs.rmSync(targetConfig, { force: true });
  }

  return {
    target,
    dir,
    success: true,
  };
}

/**
 * Test connectivity to proxy and tunnel through to Google Auth endpoint
 */
function testProxy(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port) || 7890;
  const type = options.type === 'http' ? 'http' : 'socks5';
  const targetHost = options.targetHost || 'oauth2.googleapis.com';
  const targetPort = Number(options.targetPort) || 443;
  const timeoutMs = options.timeoutMs || 4000;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve({
      ok: false,
      stage: 'config',
      error: `Invalid proxy port: ${options.port}`,
      latencyMs: 0,
    });
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let resolved = false;
    let phase = 'tcp'; // 'tcp' | 'handshake' | 'tunnel'

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    const mismatchHint = (errCode) => {
      if (phase === 'handshake' && (errCode === 'TIMEOUT' || errCode === 'ECONNRESET' || errCode === 'EOF')) {
        const other = type === 'socks5' ? 'http' : 'socks5';
        return ` Port ${port} may be speaking ${other.toUpperCase()} instead of ${type.toUpperCase()}; try switching proxy type to "${other}".`;
      }
      return '';
    };

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => {
      finish({
        ok: false,
        stage: phase,
        error: phase === 'tcp'
          ? `Connection timed out after ${timeoutMs}ms. Is your proxy client (e.g. Clash/v2ray) running on ${host}:${port}?`
          : `Timed out during ${phase} with ${host}:${port} after ${timeoutMs}ms.${mismatchHint('TIMEOUT')}`,
        latencyMs: Date.now() - startTime,
      });
    });

    socket.on('error', (err) => {
      const code = err.code || err.message;
      finish({
        ok: false,
        stage: phase,
        error: `Failed during ${phase} at ${host}:${port} (${code}).${mismatchHint(err.code)}`,
        latencyMs: Date.now() - startTime,
      });
    });

    socket.on('end', () => {
      if (!resolved) {
        finish({
          ok: false,
          stage: phase,
          error: `Proxy closed connection during ${phase} at ${host}:${port}.${mismatchHint('EOF')}`,
          latencyMs: Date.now() - startTime,
        });
      }
    });

    socket.connect(port, host, () => {
      const connectLatency = Date.now() - startTime;
      phase = 'handshake';
      let rxBuf = Buffer.alloc(0);

      if (type === 'socks5') {
        // Step 1: SOCKS5 greeting: VER 5, NMETHODS 1, METHOD 0 (No Auth)
        socket.write(Buffer.from([0x05, 0x01, 0x00]));

        let stage = 0;
        socket.on('data', (chunk) => {
          rxBuf = Buffer.concat([rxBuf, chunk]);
          if (stage === 0) {
            if (rxBuf.length >= 1 && rxBuf[0] === 0x48) { // 'H' from HTTP/1.x
              return finish({
                ok: false,
                stage: 'handshake',
                error: `Protocol mismatch: ${host}:${port} responded with HTTP instead of SOCKS5. Switch proxy type to "http".`,
                latencyMs: Date.now() - startTime,
              });
            }
            if (rxBuf.length < 2) return;
            const greeting = rxBuf.subarray(0, 2);
            rxBuf = rxBuf.subarray(2);
            if (greeting[0] !== 0x05) {
              return finish({
                ok: false,
                stage: 'handshake',
                error: `SOCKS5 handshake invalid version: expected 5, got ${greeting[0]}`,
                latencyMs: Date.now() - startTime,
              });
            }
            if (greeting[1] === 0x02) {
              return finish({
                ok: false,
                stage: 'handshake',
                error: `SOCKS5 proxy at ${host}:${port} requires username/password authentication`,
                latencyMs: Date.now() - startTime,
              });
            }
            if (greeting[1] !== 0x00) {
              return finish({
                ok: false,
                stage: 'handshake',
                error: `SOCKS5 handshake rejected: server returned [${greeting[0]}, ${greeting[1]}]`,
                latencyMs: Date.now() - startTime,
              });
            }
            stage = 1;
            phase = 'tunnel';
            // Step 2: SOCKS5 CONNECT to target
            const hostBuf = Buffer.from(targetHost, 'utf8');
            const portBuf = Buffer.alloc(2);
            portBuf.writeUInt16BE(targetPort, 0);
            const req = Buffer.concat([
              Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
              hostBuf,
              portBuf,
            ]);
            socket.write(req);
          }
          if (stage === 1 && rxBuf.length >= 2) {
            if (rxBuf[0] === 0x05 && rxBuf[1] === 0x00) {
              const totalLatency = Date.now() - startTime;
              finish({
                ok: true,
                stage: 'tunnel',
                proxy: `${host}:${port} (${type})`,
                target: `${targetHost}:${targetPort}`,
                latencyMs: totalLatency,
                connectLatencyMs: connectLatency,
                message: `Successfully connected and tunneled to ${targetHost}:${targetPort} via SOCKS5`,
              });
            } else {
              finish({
                ok: false,
                stage: 'tunnel',
                error: `SOCKS5 tunnel establishment failed: REP status ${rxBuf[1]}`,
                latencyMs: Date.now() - startTime,
              });
            }
          }
        });
      } else {
        // HTTP CONNECT request
        const connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nUser-Agent: AntigravityProxyCheck/1.0\r\n\r\n`;
        socket.write(connectReq);

        socket.on('data', (chunk) => {
          rxBuf = Buffer.concat([rxBuf, chunk]);
          if (rxBuf.length >= 1 && rxBuf[0] === 0x05) {
            return finish({
              ok: false,
              stage: 'handshake',
              error: `Protocol mismatch: ${host}:${port} responded with SOCKS5 (0x05) instead of HTTP. Switch proxy type to "socks5".`,
              latencyMs: Date.now() - startTime,
            });
          }
          const eol = rxBuf.indexOf('\r\n');
          if (eol === -1 && rxBuf.indexOf('\n') === -1 && rxBuf.length < 256) return;
          const resp = rxBuf.toString('utf8');
          const firstLine = resp.split(/\r?\n/)[0];
          if (/^HTTP\/1\.[01]\s+200\b/i.test(firstLine)) {
            const totalLatency = Date.now() - startTime;
            finish({
              ok: true,
              stage: 'tunnel',
              proxy: `${host}:${port} (${type})`,
              target: `${targetHost}:${targetPort}`,
              latencyMs: totalLatency,
              connectLatencyMs: connectLatency,
              message: `Successfully connected and tunneled to ${targetHost}:${targetPort} via HTTP CONNECT`,
            });
          } else if (/^HTTP\/1\.[01]\s+407\b/i.test(firstLine)) {
            finish({
              ok: false,
              stage: 'handshake',
              error: `HTTP proxy requires authentication (407): ${firstLine}`,
              latencyMs: Date.now() - startTime,
            });
          } else {
            finish({
              ok: false,
              stage: 'tunnel',
              error: `HTTP proxy tunnel error: ${firstLine}`,
              latencyMs: Date.now() - startTime,
            });
          }
        });
      }
    });
  });
}

function readTailSync(filePath, maxBytes = 128 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const bytesToRead = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
    } finally {
      fs.closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

const LOCATION_ERROR_PATTERNS = [
  /User location is not supported for the API use/i,
  /User location is not supported/i,
  /UNSUPPORTED_LOCATION/i,
  /not currently available in your location/i,
  /error_number\D{0,8}1008/i,
];

const SESSION_LOGIN_PATTERNS = [
  /ProjectId updated for /i,
  /\[CloudCode:AuthorizedQuota\][^\r\n]*loadCodeAssist/i,
  /Authorized quota source active/i,
  /Access token (?:updated|refreshed)/i,
  /Synced .+ to legacy key/i,
];

function collectRunLogFiles(runDirPath) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 4 || files.length >= 40) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= 40) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/^(node_modules|cache|CachedData)$/i.test(entry.name)) continue;
        walk(fullPath, depth + 1);
      } else if (/\.log$/i.test(entry.name)) {
        try {
          const st = fs.statSync(fullPath);
          files.push({ path: fullPath, name: entry.name, mtimeMs: st.mtimeMs });
        } catch {}
      }
    }
  };
  walk(runDirPath, 0);
  // Prefer ls-main.log / cloudcode.log first, then newest mtime
  return files.sort((a, b) => {
    const aPri = /^(ls-main|cloudcode)\.log$/i.test(a.name) ? 1 : 0;
    const bPri = /^(ls-main|cloudcode)\.log$/i.test(b.name) ? 1 : 0;
    if (aPri !== bPri) return bPri - aPri;
    return b.mtimeMs - a.mtimeMs;
  });
}

function inspectLogFileEvidence(filePath) {
  const content = readTailSync(filePath);
  if (!content) return { locationIdx: -1, loginIdx: -1, locationLine: '' };
  const lines = content.split(/\r?\n/);
  let locationIdx = -1;
  let loginIdx = -1;
  let locationLine = '';
  for (let i = lines.length - 1; i >= 0 && (locationIdx === -1 || loginIdx === -1); i--) {
    const line = lines[i];
    if (locationIdx === -1 && LOCATION_ERROR_PATTERNS.some((re) => re.test(line))) {
      locationIdx = i;
      locationLine = line.trim();
    }
    if (loginIdx === -1 && SESSION_LOGIN_PATTERNS.some((re) => re.test(line))) {
      loginIdx = i;
    }
  }
  return { locationIdx, loginIdx, locationLine };
}

/**
 * Scan Antigravity logs for active location restriction errors (ignoring historical errors
 * superseded by newer login-success evidence).
 */
function scanLogForLocationErrors(logDir) {
  if (!logDir || !fs.existsSync(logDir)) return [];
  const candidates = [];
  let newestLoginMtimeMs = 0;

  try {
    const entries = fs.readdirSync(logDir, { withFileTypes: true });
    // Sort directories to inspect newest first
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse()
      .slice(0, 3); // check 3 newest runs

    for (const d of dirs) {
      const files = collectRunLogFiles(path.join(logDir, d));
      for (const file of files) {
        const ev = inspectLogFileEvidence(file.path);
        if (ev.loginIdx !== -1 && file.mtimeMs > newestLoginMtimeMs) {
          newestLoginMtimeMs = file.mtimeMs;
        }
        // Ignore error if login succeeded later in the very same log file
        if (ev.locationIdx !== -1 && ev.locationIdx > ev.loginIdx) {
          candidates.push({
            logFile: file.path,
            error: 'FAILED_PRECONDITION (code 400): User location is not supported for the API use.',
            timestamp: d,
            line: ev.locationLine,
            mtimeMs: file.mtimeMs,
          });
        }
      }
    }
  } catch {}

  return candidates
    .filter((item) => item.mtimeMs >= newestLoginMtimeMs)
    .map(({ logFile, error, timestamp }) => ({ logFile, error, timestamp }));
}

const dllLoadedCache = new Map();

/**
 * Check whether the exact target version.dll (not C:\Windows\System32\version.dll)
 * is loaded inside the current Node/Electron process.
 * Cached per resolved path because DLL attachment is immutable within a process.
 */
function isDllLoadedInProcess(dllPath) {
  if (!dllPath) return null;
  const target = path.resolve(dllPath).toLowerCase();
  if (dllLoadedCache.has(target)) return dllLoadedCache.get(target);
  const reporter = process.report;
  if (!reporter || typeof reporter.getReport !== 'function') return null;

  const prevExcludeNetwork = reporter.excludeNetwork;
  let result = null;
  try {
    // Exclude network info to avoid synchronous reverse-DNS stalls inside getReport()
    reporter.excludeNetwork = true;
    const sharedObjects = reporter.getReport()?.sharedObjects;
    if (Array.isArray(sharedObjects)) {
      result = sharedObjects.some((p) => {
        if (typeof p !== 'string' || !p) return false;
        try {
          return path.resolve(p).toLowerCase() === target;
        } catch {
          return false;
        }
      });
    }
  } catch {
    result = null;
  } finally {
    reporter.excludeNetwork = prevExcludeNetwork;
  }
  dllLoadedCache.set(target, result);
  return result;
}

/**
 * Inspect running processes belonging to targetDir and verify whether targetDir\version.dll
 * is actually loaded (explicitly excluding System32\version.dll).
 */
function inspectLoadedProxyModules(targetDir, processNames = ['Antigravity', 'Antigravity IDE', 'language_server_windows_x64', 'agy']) {
  if (process.platform !== 'win32' || !targetDir) return null;
  const expectedDll = path.resolve(targetDir, 'version.dll');
  if (!fs.existsSync(expectedDll)) {
    return { dllExists: false, checked: false, running: 0, loaded: 0, samples: [] };
  }

  const normalizedDir = path.resolve(targetDir);
  const psScript = [
    '$dir = $env:AG_PROXY_DIR.TrimEnd("\\") + "\\"',
    '$dll = $env:AG_PROXY_DLL',
    '$names = @($env:AG_PROXY_NAMES -split ",")',
    '$procs = @(Get-Process -Name $names -ErrorAction SilentlyContinue)',
    '$running = 0; $loaded = 0; $enumOk = $true; $samples = @()',
    'foreach ($p in $procs) {',
    '  $pp = ""; try { $pp = [string]$p.Path } catch {}',
    '  if (-not $pp) { continue }',
    '  $inDir = $pp.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase)',
    '  if (-not $inDir -and $p.ProcessName -ne "agy") { continue }',
    '  $running++',
    '  $hit = $false',
    '  try {',
    '    foreach ($m in $p.Modules) {',
    '      if ($m.FileName -and $m.FileName.Equals($dll, [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true; break }',
    '    }',
    '  } catch { $enumOk = $false }',
    '  if ($hit) { $loaded++ }',
    '  if ($samples.Count -lt 8) { $samples += [pscustomobject]@{ name=$p.ProcessName; pid=$p.Id; loaded=$hit } }',
    '}',
    '[pscustomobject]@{ dllExists=$true; checked=$enumOk; running=$running; loaded=$loaded; samples=$samples } | ConvertTo-Json -Compress',
  ].join('; ');

  const env = {
    ...process.env,
    AG_PROXY_DIR: normalizedDir,
    AG_PROXY_DLL: expectedDll,
    AG_PROXY_NAMES: processNames.join(','),
  };

  for (const shell of ['pwsh', 'powershell']) {
    try {
      const out = execFileSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', psScript], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const parsed = JSON.parse(String(out || '').trim() || 'null');
      if (parsed && typeof parsed === 'object') {
        parsed.samples = Array.isArray(parsed.samples) ? parsed.samples : (parsed.samples ? [parsed.samples] : []);
        return parsed;
      }
    } catch {}
  }
  return null;
}

/**
 * Scan proxy DLL logs to confirm injection & tunnel state
 */
function scanProxyLogs(logDir) {
  if (!logDir || !fs.existsSync(logDir)) return [];
  const results = [];
  try {
    const files = fs.readdirSync(logDir)
      .filter((f) => f.startsWith('proxy-') && f.endsWith('.log'))
      .sort()
      .reverse()
      .slice(0, 2);
    for (const f of files) {
      const p = path.join(logDir, f);
      const content = readTailSync(p, 64 * 1024);
      const isLoaded = content.includes('Antigravity-Proxy DLL 已加载') || content.includes('已加载');
      const tunnelOk = content.includes('隧道建立成功') || content.includes('SOCKS5: 隧道建立成功');
      results.push({
        logFile: p,
        fileName: f,
        isLoaded,
        tunnelOk,
      });
    }
  } catch {}
  return results;
}

/**
 * Perform complete diagnostics on IP egress and application logs
 */
function diagnose() {
  const status = getAllStatus();
  const appData = getAppData();
  const tempLogDir = path.join(os.tmpdir(), 'antigravity-proxy-logs');

  const desktopLogDir = path.join(appData, 'Antigravity', 'logs');
  const ideLogDir = path.join(appData, 'Antigravity IDE', 'logs');

  const desktopErrors = scanLogForLocationErrors(desktopLogDir);
  const ideErrors = scanLogForLocationErrors(ideLogDir);

  const desktopProxyLogs = status.desktop.dir ? scanProxyLogs(path.join(status.desktop.dir, 'logs')) : [];
  const ideProxyLogs = status.ide.dir ? scanProxyLogs(path.join(status.ide.dir, 'logs')) : [];
  const tempProxyLogs = scanProxyLogs(tempLogDir);

  const runtimeModules = {
    desktop: status.desktop.dir ? inspectLoadedProxyModules(status.desktop.dir) : null,
    ide: status.ide.dir ? inspectLoadedProxyModules(status.ide.dir) : null,
  };

  const findings = [];

  for (const [targetName, modInfo] of Object.entries(runtimeModules)) {
    if (modInfo && modInfo.checked && modInfo.running > 0 && modInfo.loaded === 0 && status[targetName]?.installed) {
      findings.push({
        type: 'DLL_NOT_LOADED',
        severity: 'HIGH',
        title: `Proxy DLL not loaded in running ${targetName} process(es)`,
        description:
          `${modInfo.running} running ${targetName} process(es) did not load ${path.join(status[targetName].dir, 'version.dll')}. ` +
          'Restart the application completely so version.dll is loaded at startup.',
        evidence: modInfo.samples.map((s) => ({
          timestamp: 'runtime',
          logFile: `${s.name} (PID ${s.pid}) loaded=${s.loaded}`,
        })),
      });
    }
  }

  if (desktopErrors.length > 0 || ideErrors.length > 0) {
    findings.push({
      type: 'LOCATION_RESTRICTION',
      severity: 'HIGH',
      title: 'Google Location Policy Restriction (Code 400)',
      description:
        'Detected "User location is not supported for the API use" in Antigravity logs. ' +
        'This means your proxy DLL is successfully hooked and communicating, but Google API rejected your egress IP. ' +
        'Root cause: The exit node is identified as a datacenter/cloud VPS or unsupported country. ' +
        'Solution: Switch your proxy (Clash/v2ray) to a residential or supported ISP node (e.g. non-datacenter Singapore, Japan, or US node).',
      evidence: [...desktopErrors, ...ideErrors],
    });
  }

  return {
    status,
    desktopLogDir,
    ideLogDir,
    runtimeModules,
    proxyLogs: [...desktopProxyLogs, ...ideProxyLogs, ...tempProxyLogs],
    findings,
  };
}

// -----------------------------------------------------------------------------
// CLI Execution
// -----------------------------------------------------------------------------

function runCli() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('\nUsage: node proxy-manager.cjs [status|install|uninstall|test|diagnose] [options]');
    console.log('\nOptions:');
    console.log('  --target <desktop|ide|all>  Target installation environment (default: all)');
    console.log('  --port <port>               Proxy port (default: 7890)');
    console.log('  --type <socks5|http>        Proxy protocol (default: socks5)');
    console.log('  --force                     Kill running processes if required during file replace');
    console.log('  --host <host>               Proxy host for connectivity testing (default: 127.0.0.1)\n');
    return;
  }

  function getArg(name, def = null) {
    const idx = args.indexOf(name);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return def;
  }
  const hasFlag = (name) => args.includes(name);

  if (command === 'status') {
    const status = getAllStatus();
    console.log('\n======================================================');
    console.log('🛡️  Antigravity Local Process Proxy Status');
    console.log('======================================================\n');

    for (const [name, s] of Object.entries(status)) {
      if (!s || typeof s !== 'object') continue;
      console.log(`[${name.toUpperCase()}]`);
      console.log(`  Path:      ${s.dir || 'Not Found'}`);
      console.log(`  Installed: ${s.installed ? '✅ Yes (version.dll + config.json)' : '❌ No'}`);
      console.log(`  Running:   ${s.isRunning ? '⚠️ Running' : 'Idle'}`);
      if (s.config) {
        console.log(`  Proxy:     ${s.config.proxy?.type}://${s.config.proxy?.host}:${s.config.proxy?.port}`);
      }
      if (s.logDir) {
        console.log(`  Logs:      ${s.logDir}`);
      }
      console.log('');
    }
  } else if (command === 'install') {
    const target = getArg('--target', 'all');
    const port = Number(getArg('--port', '7890'));
    const type = getArg('--type', 'socks5');
    const forceKill = hasFlag('--force');

    console.log('\n======================================================');
    console.log(`📦 Installing Local Process Proxy (Target: ${target}, ${type}://127.0.0.1:${port})`);
    console.log('======================================================\n');

    const targets = target === 'all' ? ['desktop', 'ide'] : [target];
    let hadError = false;
    for (const t of targets) {
      try {
        const res = installProxy(t, { port, type, forceKill });
        console.log(`✅ [${t.toUpperCase()}] Successfully deployed version.dll and config.json to: ${res.dir}`);
      } catch (err) {
        hadError = true;
        console.error(`❌ [${t.toUpperCase()}] Installation failed: ${err.message}`);
      }
    }
    if (hadError) process.exitCode = 1;
    console.log('');
  } else if (command === 'uninstall') {
    const target = getArg('--target', 'all');
    const forceKill = hasFlag('--force');

    console.log('\n======================================================');
    console.log(`↺ Uninstalling Local Process Proxy (Target: ${target})`);
    console.log('======================================================\n');

    const targets = target === 'all' ? ['desktop', 'ide'] : [target];
    let hadError = false;
    for (const t of targets) {
      try {
        const res = uninstallProxy(t, { forceKill });
        if (res.success) {
          console.log(`✅ [${t.toUpperCase()}] Cleanly removed proxy files from: ${res.dir}`);
        } else {
          console.log(`ℹ️ [${t.toUpperCase()}] ${res.reason}`);
        }
      } catch (err) {
        hadError = true;
        console.error(`❌ [${t.toUpperCase()}] Uninstall failed: ${err.message}`);
      }
    }
    if (hadError) process.exitCode = 1;
    console.log('');
  } else if (command === 'test') {
    const host = getArg('--host', '127.0.0.1');
    const port = Number(getArg('--port', '7890'));
    const type = getArg('--type', 'socks5');

    console.log('\n======================================================');
    console.log(`🌐 Testing Proxy Connectivity (${type}://${host}:${port} -> Google API)`);
    console.log('======================================================\n');

    testProxy({ host, port, type }).then((res) => {
      if (res.ok) {
        console.log(`✅ SUCCESS: ${res.message}`);
        console.log(`  TCP Latency:    ${res.connectLatencyMs}ms`);
        console.log(`  Tunnel Latency: ${res.latencyMs}ms\n`);
      } else {
        console.error(`❌ FAILED: ${res.error}\n`);
        process.exitCode = 1;
      }
    });
  } else if (command === 'diagnose') {
    console.log('\n======================================================');
    console.log('🔍 Running Antigravity Proxy & Egress Diagnostics');
    console.log('======================================================\n');

    const report = diagnose();
    if (report.findings.length === 0) {
      console.log('✅ No location restrictions (400 User location is not supported) found in recent logs.');
      console.log('If you still encounter connection errors, verify proxy server logs and active ports.');
    } else {
      for (const f of report.findings) {
        console.log(`🚨 [${f.severity}] ${f.title}`);
        console.log(`  ${f.description}\n`);
        console.log('  Evidence:');
        for (const ev of f.evidence) {
          console.log(`  - [${ev.timestamp}] ${ev.logFile}`);
        }
      }
    }
    if (report.proxyLogs && report.proxyLogs.length > 0) {
      console.log('\nDLL Logs Found:');
      for (const pl of report.proxyLogs) {
        console.log(`  - ${pl.fileName}: Loaded=${pl.isLoaded}, TunnelOk=${pl.tunnelOk}`);
      }
    }
    console.log('');
  } else {
    console.log(`Unknown command: ${command}`);
    console.log('Usage: node proxy-manager.cjs [status|install|uninstall|test|diagnose] [--target desktop|ide|all] [--port <port>] [--type socks5|http] [--force]');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  findDesktopDir,
  findIdeDir,
  getVendorDllPath,
  buildConfig,
  parseJsonTolerant,
  isDllLoadedInProcess,
  inspectLoadedProxyModules,
  getTargetStatus,
  getAllStatus,
  resolveProxyLogDir,
  installProxy,
  uninstallProxy,
  testProxy,
  scanLogForLocationErrors,
  diagnose,
};
