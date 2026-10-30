#!/usr/bin/env node
/**
 * Antigravity Transparent Proxy Manager
 *
 * Integrates and manages yuaotian/antigravity-proxy (MinHook-based transparent socket hook)
 * for both Google Antigravity Desktop (Electron) and Antigravity IDE (VSCode fork).
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
const { execFileSync } = require('node:child_process');

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
function isProcessRunning(processName, maxAgeMs = 5000) {
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
 * Build standard config.json structure for antigravity-proxy
 */
function buildConfig(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port) || 7890;
  const type = options.type === 'http' ? 'http' : 'socks5';

  return {
    _managed_by: 'antigravity-token-stats',
    _version: '2.4',
    log_level: options.logLevel || 'info',
    traffic_logging: Boolean(options.trafficLogging),
    ui: {
      load_notify: options.loadNotify || 'once',
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
      agent_ip_probe: options.agentIpProbe !== false,
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

/**
 * Read current proxy status for Desktop and IDE targets
 */
function getTargetStatus(target, customDir) {
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
    };
  }

  const dllPath = path.join(dir, 'version.dll');
  const configPath = path.join(dir, 'config.json');
  const dllExists = fs.existsSync(dllPath);
  const configExists = fs.existsSync(configPath);
  const isRunning = isProcessRunning(exeName);

  let config = null;
  if (configExists) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
  }

  return {
    target,
    installed: dllExists && configExists,
    available: true,
    dir,
    exeExists: true,
    isRunning,
    dllExists,
    configExists,
    config,
  };
}

/**
 * Get comprehensive status for all supported targets
 */
function getAllStatus() {
  return {
    desktop: getTargetStatus('desktop'),
    ide: getTargetStatus('ide'),
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

  // Check if version.dll already exists and matches the vendor DLL.
  // If identical, we don't need to overwrite it, avoiding Windows EBUSY locking
  // even while the application is active.
  let needsDllCopy = true;
  if (fs.existsSync(targetDll)) {
    try {
      const vendorStat = fs.statSync(vendorDll);
      const targetStat = fs.statSync(targetDll);
      if (vendorStat.size === targetStat.size) {
        const vBuf = fs.readFileSync(vendorDll);
        const tBuf = fs.readFileSync(targetDll);
        if (vBuf.equals(tBuf)) {
          needsDllCopy = false;
        }
      }
    } catch {}
  }

  if (needsDllCopy) {
    if (!options.skipProcessCheck && isProcessRunning(exeName) && !options.forceKill) {
      throw new Error(`Cannot install proxy: ${exeName} is currently running. Close the application first or pass --force.`);
    }
    try {
      fs.copyFileSync(vendorDll, targetDll);
    } catch (err) {
      if (err.code === 'EBUSY') {
        throw new Error(`Cannot update version.dll: ${exeName} is currently locking the file. Close the application and retry.`);
      }
      throw err;
    }
  }

  // Generate and write config (always safe and un-locked)
  const config = buildConfig(options);
  fs.writeFileSync(targetConfig, JSON.stringify(config, null, 2), 'utf8');

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
  const targetHost = 'oauth2.googleapis.com';
  const targetPort = 443;
  const timeoutMs = options.timeoutMs || 4000;

  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => {
      finish({
        ok: false,
        error: `Connection timed out after ${timeoutMs}ms. Is your proxy client (e.g. Clash/v2ray) running on ${host}:${port}?`,
        latencyMs: Date.now() - startTime,
      });
    });

    socket.on('error', (err) => {
      finish({
        ok: false,
        error: `Failed to connect to proxy at ${host}:${port} (${err.code || err.message})`,
        latencyMs: Date.now() - startTime,
      });
    });

    socket.connect(port, host, () => {
      const connectLatency = Date.now() - startTime;

      if (type === 'socks5') {
        // Step 1: SOCKS5 greeting: VER 5, NMETHODS 1, METHOD 0 (No Auth)
        socket.write(Buffer.from([0x05, 0x01, 0x00]));

        let stage = 0;
        socket.on('data', (data) => {
          if (stage === 0) {
            // Expect [0x05, 0x00]
            if (data[0] !== 0x05 || data[1] !== 0x00) {
              return finish({
                ok: false,
                error: `SOCKS5 handshake rejected: server returned [${data[0]}, ${data[1]}]`,
                latencyMs: Date.now() - startTime,
              });
            }
            stage = 1;
            // Step 2: SOCKS5 CONNECT to oauth2.googleapis.com:443
            const hostBuf = Buffer.from(targetHost, 'utf8');
            const portBuf = Buffer.alloc(2);
            portBuf.writeUInt16BE(targetPort, 0);
            const req = Buffer.concat([
              Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
              hostBuf,
              portBuf,
            ]);
            socket.write(req);
          } else if (stage === 1) {
            // Expect reply with REP 0 (Success)
            if (data[0] === 0x05 && data[1] === 0x00) {
              const totalLatency = Date.now() - startTime;
              finish({
                ok: true,
                proxy: `${host}:${port} (${type})`,
                target: `${targetHost}:${targetPort}`,
                latencyMs: totalLatency,
                connectLatencyMs: connectLatency,
                message: `Successfully connected and tunneled to ${targetHost}:${targetPort} via SOCKS5`,
              });
            } else {
              finish({
                ok: false,
                error: `SOCKS5 tunnel establishment failed: REP status ${data[1]}`,
                latencyMs: Date.now() - startTime,
              });
            }
          }
        });
      } else {
        // HTTP CONNECT request
        const connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nUser-Agent: AntigravityProxyCheck/1.0\r\n\r\n`;
        socket.write(connectReq);

        socket.once('data', (data) => {
          const resp = data.toString('utf8');
          if (resp.startsWith('HTTP/1.1 200') || resp.startsWith('HTTP/1.0 200')) {
            const totalLatency = Date.now() - startTime;
            finish({
              ok: true,
              proxy: `${host}:${port} (${type})`,
              target: `${targetHost}:${targetPort}`,
              latencyMs: totalLatency,
              connectLatencyMs: connectLatency,
              message: `Successfully connected and tunneled to ${targetHost}:${targetPort} via HTTP CONNECT`,
            });
          } else {
            finish({
              ok: false,
              error: `HTTP proxy tunnel error: ${resp.split('\r\n')[0]}`,
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

/**
 * Scan Antigravity logs for location restriction errors
 */
function scanLogForLocationErrors(logDir) {
  if (!fs.existsSync(logDir)) return [];
  const results = [];

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
      const lsMainPath = path.join(logDir, d, 'ls-main.log');
      if (fs.existsSync(lsMainPath)) {
        const content = readTailSync(lsMainPath);
        if (content.includes('User location is not supported for the API use')) {
          results.push({
            logFile: lsMainPath,
            error: 'FAILED_PRECONDITION (code 400): User location is not supported for the API use.',
            timestamp: d,
          });
        }
      }
    }
  } catch {}

  return results;
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
  const tempProxyLogs = scanProxyLogs(tempLogDir);

  const findings = [];

  if (desktopErrors.length > 0 || ideErrors.length > 0) {
    findings.push({
      type: 'LOCATION_RESTRICTION',
      severity: 'HIGH',
      title: 'Google Location Policy Restriction (Code 400)',
      description:
        'Detected "User location is not supported for the API use" in Antigravity ls-main.log. ' +
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
    proxyLogs: [...desktopProxyLogs, ...tempProxyLogs],
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
    console.log('🛡️  Antigravity Transparent Proxy Status');
    console.log('======================================================\n');

    for (const [name, s] of Object.entries(status)) {
      console.log(`[${name.toUpperCase()}]`);
      console.log(`  Path:      ${s.dir || 'Not Found'}`);
      console.log(`  Installed: ${s.installed ? '✅ Yes (version.dll + config.json)' : '❌ No'}`);
      console.log(`  Running:   ${s.isRunning ? '⚠️ Running' : 'Idle'}`);
      if (s.config) {
        console.log(`  Proxy:     ${s.config.proxy?.type}://${s.config.proxy?.host}:${s.config.proxy?.port}`);
      }
      console.log('');
    }
  } else if (command === 'install') {
    const target = getArg('--target', 'all');
    const port = Number(getArg('--port', '7890'));
    const type = getArg('--type', 'socks5');
    const forceKill = hasFlag('--force');

    console.log('\n======================================================');
    console.log(`📦 Installing Transparent Proxy (Target: ${target}, ${type}://127.0.0.1:${port})`);
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
    console.log(`↺ Uninstalling Transparent Proxy (Target: ${target})`);
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
  getTargetStatus,
  getAllStatus,
  installProxy,
  uninstallProxy,
  testProxy,
  scanLogForLocationErrors,
  diagnose,
};
