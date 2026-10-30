# Antigravity Transparent Proxy Integration & Adaptation Plan

This document details the architectural design, implementation, and adaptation strategy for incorporating the core capabilities of [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy) into **Antigravity Token Stats** (`anti token`), adapting it seamlessly across both **Google Antigravity Desktop** and **Antigravity IDE**.

---

## 1. Executive Summary & Problem Context

### The Challenge
Developers using Google Antigravity 2.0 (Desktop client) and Antigravity IDE in restricted regions (such as Mainland China) face critical network connectivity barriers:
1. **Network Layer Isolation**: Standard system proxy settings (`HTTP_PROXY`/`HTTPS_PROXY`) or VPNs often fail to capture low-level TCP/gRPC socket calls initiated by Electron background helper processes (`language_server_windows_x64.exe`, `node.exe`, `agy.exe`).
2. **TUN Mode Drawbacks**: Forcing traffic through global TUN mode requires elevated administrator privileges, hijacks all machine-wide IP traffic (disrupting local microservices, WSL, and intranet routes), and incurs network latency.
3. **Google Egress Location Policy (Code 400)**: Even when a proxy tunnel is operational, Google API endpoints (`oauth2.googleapis.com`, `cloudcode-pa.googleapis.com`) inspect the exit IP ASN and geolocation. Datacenter, cloud VPS, or unsupported region IPs trigger:
   ```text
   agent executor error: FAILED_PRECONDITION (code 400): User location is not supported for the API use.
   ```

### The Solution: Absorbing `antigravity-proxy`
`yuaotian/antigravity-proxy` solves this via MinHook-based DLL search order hijacking (`version.dll` for applications and `dbghelp.dll` for CLI):
- Hooks Winsock socket connection routines (`connect`, `ConnectEx`, `WSAConnect`, `WSAConnectByName`, `GetAddrInfoW`).
- Intercepts child processes via `CreateProcessW` hooks, propagating the hook into `language_server_windows_x64.exe` and `node.exe`.
- Transparently routes outbound traffic to a local SOCKS5 or HTTP proxy (e.g., Clash / v2ray on `127.0.0.1:7890`), while preserving direct connections for loopback (`127.0.0.1` / localhost) so internal IPC and TLS are never broken.
- Requires **zero administrator privileges** and leaves system-wide network behavior completely untouched.

---

## 2. Architectural Design & Module Boundaries

Guided by **John Ousterhout's *A Philosophy of Software Design***, the integration introduces **deep modules** with narrow public contracts that conceal internal filesystem mechanics, process locking, and socket handshakes.

```
+-----------------------------------------------------------------------------------+
|                                 Shared UI Layer                                   |
|   src/components/stats/ProxyStatusCard.tsx  <-->  src/i18n/translations.ts        |
+-----------------------------------------------------------------------------------+
                                       ^
                                       | stats.proxy (getAllStatus)
+-----------------------------------------------------------------------------------+
|                              Aggregation Engine                                   |
|                           scripts/aggregate-stats.cjs                             |
+-----------------------------------------------------------------------------------+
                                       ^
                                       | (require)
+-----------------------------------------------------------------------------------+
|                         Core Proxy Engine (Deep Module)                           |
|                            scripts/proxy-manager.cjs                              |
|   - detectTargets()        - installProxy(target)        - uninstallProxy(target) |
|   - testProxy()            - scanLogForLocationErrors()  - diagnose()             |
+-----------------------------------------------------------------------------------+
           |                                                   |
           v                                                   v
+-----------------------------+             +---------------------------------------+
|    Desktop Adapter Host     |             |           IDE Adapter Host            |
|     hosts/antigravity/      |             |         hosts/antigravity-ide/        |
| - paths.cjs                 |             | - extension/src/extension.ts          |
| - patch-antigravity.cjs     |             | - extension/package.json              |
| - unpatch-antigravity.cjs   |             | - src/ide-contract.ts                 |
| - install.ps1               |             | - scripts/build-extension-ide.cjs     |
+-----------------------------+             +---------------------------------------+
           |                                                   |
           v                                                   v
+-----------------------------+             +---------------------------------------+
|  Antigravity Desktop Path   |             |         Antigravity IDE Path          |
|  %LOCALAPPDATA%\Programs\   |             |  D:\Programs\Antigravity IDE\         |
|  antigravity\               |             |  - version.dll                        |
|  - version.dll              |             |  - config.json                        |
|  - config.json              |             |  - Antigravity IDE.exe                |
|  - Antigravity.exe          |             +---------------------------------------+
+-----------------------------+
```

### Module Responsibilities:

1. **`vendor/proxy/win-x64/` (Pre-verified Binaries)**
   - Houses verified `version.dll` (SHA256: `40F037232A180DA8DFF7611021270549FCC4E208580D8BF0F70BC9975F871B5F`) and `config.template.json` from upstream v2.4.
   - Bundled automatically during release packaging (`npm run package:release`).

2. **`scripts/proxy-manager.cjs` (Unified Proxy Engine)**
   - **Target Discovery**: Automatically locates Desktop (`Antigravity.exe`) and IDE (`Antigravity IDE.exe`) across standard locations and environment variables (`ANTIGRAVITY_IDE_DIR`, `ANTIGRAVITY_IDE_CMD`).
   - **Configuration Management**: Generates tuned `config.json` supporting SOCKS5 and HTTP protocols, `child_injection`, loopback bypass rules, and diagnostic probing.
   - **Safe File Operations**: Prevents Windows `EBUSY` file locking by verifying process status (`Antigravity.exe` / `Antigravity IDE.exe`) before file operations.
   - **Connectivity & Socket Testing**: Validates local proxy reachability, negotiates SOCKS5/HTTP handshakes, and measures end-to-end latency to `oauth2.googleapis.com:443`.
   - **Location Error Diagnostics**: Scans recent `%APPDATA%\Antigravity\logs\` and `%APPDATA%\Antigravity IDE\logs\` for `User location is not supported for the API use` and explains root-cause solutions.

3. **`hosts/antigravity/` (Desktop Host Adaptation)**
   - `paths.cjs`: Exposes `getProxyDllPath()`, `getProxyConfigPath()`, and `isProxyInstalled()`.
   - `patch-antigravity.cjs`: Supports `--with-proxy` flag to install transparent proxy alongside the stats patch.
   - `unpatch-antigravity.cjs`: Automatically removes `version.dll` and `config.json` during factory restore.
   - `install.ps1`: Supports `-Proxy`, `-ProxyPort`, and `-ProxyType` switches.

4. **`hosts/antigravity-ide/` (IDE Host Adaptation)**
   - Registers IDE commands in `package.json` and `extension.ts`:
     - `antigravity-ide-stats.proxyStatus`: View live proxy status and active port.
     - `antigravity-ide-stats.proxyInstall`: Interactive prompt to configure and install proxy for the IDE.
   - `build-extension-ide.cjs`: Copies `proxy-manager.cjs` into `extension/out/` for standalone operation.

5. **`src/components/stats/ProxyStatusCard.tsx` (Shared UI Layer)**
   - Modern, reactive card integrated into `StatsView.tsx`.
   - Displays real-time status (Active / Inactive, Running / Idle, Protocol, Host & Port) for both Desktop and IDE.
   - Shows CLI management quick commands and location policy recommendations.
   - Full bilingual localization (English / 简体中文).

---

## 3. Configuration Specification

The proxy engine generates a standards-compliant `config.json` adhering to `yuaotian/antigravity-proxy` specifications:

```json
{
  "_managed_by": "antigravity-token-stats",
  "_version": "2.4",
  "log_level": "info",
  "traffic_logging": false,
  "proxy": {
    "type": "socks5",
    "host": "127.0.0.1",
    "port": 7890
  },
  "fake_ip": {
    "cidr": "198.18.0.0/15",
    "enabled": true
  },
  "child_injection": true,
  "child_injection_mode": "filtered",
  "child_injection_exclude": [],
  "target_processes": [
    "agy.exe",
    "language_server.exe",
    "language_server_windows_x64.exe",
    "language_server_windows",
    "Antigravity.exe",
    "Antigravity IDE.exe",
    "node.exe"
  ],
  "proxy_rules": {
    "routing": {
      "default_action": "proxy",
      "priority_mode": "order",
      "rules": [],
      "use_default_private": true,
      "enabled": true
    },
    "allowed_ports": [80, 443],
    "udp_mode": "auto",
    "ipv6_mode": "proxy",
    "udp_fallback": "block",
    "dns_mode": "direct"
  },
  "timeout": {
    "connect": 5000,
    "recv": 5000,
    "send": 5000
  },
  "diagnostics": {
    "agent_ip_probe": true
  }
}
```

---

## 4. Usage & Workflows

### 4.1 CLI Commands

| Command | Description |
| :--- | :--- |
| `npm run proxy:status` | Check proxy installation & running status for Desktop and IDE |
| `npm run proxy:install` | Install transparent proxy for all targets (default: `socks5://127.0.0.1:7890`) |
| `npm run proxy:install -- --target desktop --port 7890` | Install for Desktop client only |
| `npm run proxy:install -- --target ide --port 7890` | Install for Antigravity IDE only |
| `npm run proxy:uninstall` | Cleanly remove `version.dll` and `config.json` from all targets |
| `npm run proxy:test` | Test local proxy connectivity and Google API handshake |
| `npm run proxy:diagnose` | Run full diagnosis on recent logs and detect location restrictions |

### 4.2 PowerShell One-Click Setup

```powershell
# Install Token Stats + Transparent Proxy in one step
pwsh -File .\install.ps1 -Proxy -ProxyPort 7890
```

### 4.3 IDE In-App Management
In Antigravity IDE:
1. Press `Ctrl+Shift+P` (Command Palette).
2. Type `Antigravity Proxy: Show Status & Diagnostics` to view current status.
3. Type `Antigravity Proxy: Configure & Install Transparent Proxy` to configure a port and enable proxy on the fly.

---

## 5. Troubleshooting & Field Diagnosis

### Issue 1: `Agent execution terminated due to error` / Code 400
- **Symptoms**: `ls-main.log` contains `FAILED_PRECONDITION (code 400): User location is not supported for the API use.`
- **Diagnosis**: The DLL injection and proxy handshake are working properly. Google API has classified your proxy node's exit IP as a datacenter/cloud VPS or unsupported country.
- **Resolution**:
  1. Run `npm run proxy:diagnose` to confirm the log error evidence.
  2. Switch your proxy client (Clash/v2ray) to a residential or supported ISP node (e.g., non-datacenter Singapore, Japan, or US node).

### Issue 2: Windows Error `0xc0000142` on Launch
- **Cause**: Missing Microsoft Visual C++ Runtime libraries.
- **Resolution**: Install the latest [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe).

### Issue 3: `EBUSY` Resource Locking During Install/Uninstall
- **Cause**: Antigravity or Antigravity IDE is currently running with `version.dll` loaded.
- **Resolution**: Close Antigravity and Antigravity IDE before installing or uninstalling, or pass `--force` to automatically terminate the processes.

---

## 6. Verification & Quality Assurance

- **Unit & Integration Suite**: `scripts/test-proxy-manager.cjs` verifies:
  - Upstream v2.4 configuration schema compliance.
  - Desktop and IDE filesystem discovery.
  - Mock sandbox installation, atomic file writes, and clean uninstallation.
  - Log diagnostic scanner against synthetic `ls-main.log` files.
  - Proxy connectivity timeout and error resilience.
- **Full Offline Regression**: Tested via `npm test` across all 5 test suites.
- **Build Verification**: Verified with `npm run build`, `npm run build:bundle`, `npm run build:bundle:ide`, and `npm run build:extension:ide`.
