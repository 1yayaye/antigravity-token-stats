using System.Collections.Generic;

namespace AntiTokenSetup.Models
{
    public sealed class ContractData
    {
        public string Version { get; set; } = "1.5.0";
        public string MarkerMainHook { get; set; } = "__ANTIGRAVITY_STATS_INJECTION__";
        public string MarkerPreloadBridge { get; set; } = "__ANTIGRAVITY_STATS_PRELOAD_BRIDGE__";
        public string WindowSyncBridge { get; set; } = "__ANTIGRAVITY_SYNC_BRIDGE__";
        public string IpcRequestSync { get; set; } = "antigravity:request-sync";
    }

    public sealed class DesktopInstallInfo
    {
        public string RootDir { get; set; } = "";
        public string ResourcesDir { get; set; } = "";
        public string ExePath { get; set; } = "";
        public string AsarPath { get; set; } = "";
        public string BackupPath { get; set; } = "";
        public string Source { get; set; } = "";

        public bool Exists { get; set; }
        public bool HasAsar { get; set; }
        public bool IsPatched { get; set; }
        public bool HasBackup { get; set; }
        public bool IsRunning { get; set; }
        public bool NeedsElevation { get; set; }

        public bool ProxyInstalled { get; set; }
        public string ExistingProxyType { get; set; }
        public string ExistingProxyHost { get; set; }
        public int ExistingProxyPort { get; set; }

        public string DisplayLabel => string.IsNullOrEmpty(Source)
            ? RootDir
            : $"{RootDir}  ({Source})";
    }

    public sealed class ProxyCandidate
    {
        public int Port { get; set; }
        public string Host { get; set; } = "127.0.0.1";
        public bool SupportsSocks5 { get; set; }
        public bool SupportsHttp { get; set; }
        public string ProcessName { get; set; } = "";
        public int Pid { get; set; }
        public bool IsSystemProxy { get; set; }
        public bool IsExistingConfig { get; set; }
        public string PreferredProtocol => SupportsSocks5 ? "socks5" : "http";

        public string ProtocolLabel
        {
            get
            {
                if (SupportsSocks5 && SupportsHttp) return "SOCKS5 / HTTP";
                if (SupportsSocks5) return "SOCKS5";
                if (SupportsHttp) return "HTTP";
                return "TCP";
            }
        }

        public string DisplayText
        {
            get
            {
                var parts = new List<string> { $"{Host}:{Port}", $"[{ProtocolLabel}]" };
                if (!string.IsNullOrEmpty(ProcessName))
                {
                    parts.Add($"({ProcessName})");
                }
                if (IsSystemProxy)
                {
                    parts.Add("★ System");
                }
                else if (IsExistingConfig)
                {
                    parts.Add("● Current");
                }
                return string.Join("  ", parts);
            }
        }
    }

    public sealed class ProxyTestResult
    {
        public bool Ok { get; set; }
        public string Message { get; set; } = "";
        public long ConnectLatencyMs { get; set; }
        public long TotalLatencyMs { get; set; }
    }

    public sealed class PatchResult
    {
        public bool Patched { get; set; }
        public bool BackupCreated { get; set; }
        public bool BackupRefreshed { get; set; }
        public string AsarPath { get; set; } = "";
        public long SizeBytes { get; set; }
    }

    public sealed class UnpatchResult
    {
        public bool Restored { get; set; }
        public bool Pristine { get; set; }
        public bool ProxyRemoved { get; set; }
        public string Message { get; set; } = "";
    }
}
