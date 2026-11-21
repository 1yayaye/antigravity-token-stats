# Local Process Proxy Vendor Binaries

This directory contains pre-verified binary assets for local process socket proxy forwarding.

- **Target Architecture**: Windows x64
- **Version**: 2.6.3 (custom MSVC static-runtime build without IDE extension tray prompt)
- **Artifacts**:
  - `win-x64/version.dll`: Socket proxy DLL (hooks `connect`, `ConnectEx`, `WSAConnect`, etc. to route outbound traffic via SOCKS5/HTTP, preserving local TLS on loopback, FakeIP direct-target/port=0 fixes, and 60s SOCKS5 UDP ASSOCIATE backoff).
    - SHA256: `31502B5136F6C73092A27CCB8E82494B8A20C7CB9D40EDF1D298487543164861`
  - `win-x64/config.template.json`: Default baseline configuration with child process injection, loopback bypass, `diagnostics.agent_ip_probe: false`, and `ui.load_notify: "none"`.
