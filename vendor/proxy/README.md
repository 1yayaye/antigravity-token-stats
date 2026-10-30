# Antigravity Proxy Vendor Binaries

This directory contains pre-verified binary assets derived from [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy) (Release v2.4).

- **Source Repository**: https://github.com/yuaotian/antigravity-proxy
- **Upstream License**: BSD-2-Clause
- **Target Architecture**: Windows x64
- **Version**: 2.4
- **Artifacts**:
  - `win-x64/version.dll`: MinHook-based transparent socket proxy injector (hooks `connect`, `ConnectEx`, `WSAConnect`, etc. to route outbound traffic via SOCKS5/HTTP without TUN mode, preserving local TLS on loopback).
    - SHA256: `40F037232A180DA8DFF7611021270549FCC4E208580D8BF0F70BC9975F871B5F`
  - `win-x64/config.template.json`: Default baseline configuration with child process injection and loopback bypass.
