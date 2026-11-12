using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AntiTokenSetup.Models;
using Microsoft.Win32;

namespace AntiTokenSetup.Services
{
    public static class EnvironmentDetector
    {
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        private const int AF_INET = 2;
        private const int AF_INET6 = 23;
        private const uint MIB_TCP_STATE_LISTEN = 2;

        private static readonly int[] CommonProxyPorts =
        {
            7890, 7897, 7891, 7892, 7893,
            10808, 10809, 1080, 1081,
            2080, 2081, 20170, 20171, 20172,
            8080, 8888, 9090, 9910, 10800, 10801
        };

        private static readonly string[] KnownProxyKeywords =
        {
            "mihomo", "clash", "verge", "v2ray", "xray", "sing-box",
            "nekoray", "nekobox", "flclash", "hiddify", "shadowsocks",
            "ssr", "surge", "privoxy", "trojan", "brook", "tuic",
            "naive", "nyanpasu", "karing", "sparkle"
        };

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, int processId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref int lpdwSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);

        [DllImport("iphlpapi.dll", SetLastError = true)]
        private static extern uint GetExtendedTcpTable(
            IntPtr pTcpTable,
            ref int dwOutBufLen,
            bool sort,
            int ipVersion,
            TCP_TABLE_CLASS tblClass,
            uint reserved);

        private enum TCP_TABLE_CLASS
        {
            TCP_TABLE_BASIC_LISTENER,
            TCP_TABLE_BASIC_CONNECTIONS,
            TCP_TABLE_BASIC_ALL,
            TCP_TABLE_OWNER_PID_LISTENER,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            TCP_TABLE_OWNER_PID_ALL
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MIB_TCPROW_OWNER_PID
        {
            public uint state;
            public uint localAddr;
            public byte localPort1;
            public byte localPort2;
            public byte localPort3;
            public byte localPort4;
            public uint remoteAddr;
            public byte remotePort1;
            public byte remotePort2;
            public byte remotePort3;
            public byte remotePort4;
            public int owningPid;

            public int LocalPort => (localPort1 << 8) | localPort2;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MIB_TCP6ROW_OWNER_PID
        {
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)]
            public byte[] ucLocalAddr;
            public uint dwLocalScopeId;
            public uint dwLocalPort;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)]
            public byte[] ucRemoteAddr;
            public uint dwRemoteScopeId;
            public uint dwRemotePort;
            public uint dwState;
            public int dwOwningPid;

            public int LocalPort => (int)(((dwLocalPort & 0xFF) << 8) | ((dwLocalPort >> 8) & 0xFF));
        }

        private sealed class ListenerInfo
        {
            public int Port;
            public int Pid;
            public string ProcessName = "";
            public bool IsIpv4;
            public bool IsIpv6;
        }

        public static bool IsAdministrator()
        {
            try
            {
                using (var identity = WindowsIdentity.GetCurrent())
                {
                    var principal = new WindowsPrincipal(identity);
                    return principal.IsInRole(WindowsBuiltInRole.Administrator);
                }
            }
            catch
            {
                return false;
            }
        }

        public static bool IsAntigravityRunning()
        {
            try
            {
                return Process.GetProcessesByName("Antigravity").Length > 0;
            }
            catch
            {
                return false;
            }
        }

        public static bool StopAntigravityProcesses(int timeoutMs = 5000)
        {
            var procs = Process.GetProcessesByName("Antigravity");
            foreach (var proc in procs)
            {
                try
                {
                    if (!proc.HasExited)
                    {
                        proc.Kill();
                    }
                }
                catch { }
                finally
                {
                    proc.Dispose();
                }
            }

            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (!IsAntigravityRunning()) return true;
                Thread.Sleep(150);
            }
            return !IsAntigravityRunning();
        }

        public static string NormalizeDirectoryPath(string pathInput)
        {
            if (string.IsNullOrWhiteSpace(pathInput)) return "";
            string full = Path.GetFullPath(pathInput.Trim().Trim('"'));
            if (full.Length > 3)
            {
                full = full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            }
            return full;
        }

        public static string NormalizeDesktopRoot(string pathInput)
        {
            string normalized = NormalizeDirectoryPath(pathInput);
            if (string.IsNullOrEmpty(normalized)) return "";
            if (string.Equals(Path.GetFileName(normalized), "resources", StringComparison.OrdinalIgnoreCase))
            {
                normalized = Path.GetDirectoryName(normalized) ?? normalized;
            }
            return normalized;
        }

        public static void RelaunchElevated(string selectedRootDir)
        {
            string exePath = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exePath)) return;

            var psi = new ProcessStartInfo
            {
                FileName = exePath,
                Verb = "runas",
                UseShellExecute = true
            };
            string cleanDir = NormalizeDesktopRoot(selectedRootDir).TrimEnd('\\');
            if (!string.IsNullOrEmpty(cleanDir))
            {
                psi.Arguments = $"--dir \"{cleanDir}\"";
            }
            Process.Start(psi);
        }

        public static List<DesktopInstallInfo> DetectDesktopInstallations(ContractData contract, string preferredPath = null)
        {
            var candidates = new List<(string RootDir, string Source)>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            void AddCandidate(string dir, string source)
            {
                if (string.IsNullOrWhiteSpace(dir)) return;
                try
                {
                    string normalized = NormalizeDesktopRoot(dir);
                    if (string.IsNullOrEmpty(normalized) || !seen.Add(normalized)) return;
                    candidates.Add((normalized, source));
                }
                catch { }
            }

            if (!string.IsNullOrWhiteSpace(preferredPath))
            {
                AddCandidate(preferredPath, "Selected");
            }

            // 1. Running Antigravity.exe process
            try
            {
                foreach (var proc in Process.GetProcessesByName("Antigravity"))
                {
                    try
                    {
                        string procPath = TryGetProcessPath(proc.Id);
                        if (!string.IsNullOrEmpty(procPath) &&
                            string.Equals(Path.GetFileName(procPath), "Antigravity.exe", StringComparison.OrdinalIgnoreCase))
                        {
                            AddCandidate(Path.GetDirectoryName(procPath), "Running");
                        }
                    }
                    finally
                    {
                        proc.Dispose();
                    }
                }
            }
            catch { }

            // 2. Windows Uninstall Registry (Desktop only, exclude Antigravity IDE)
            foreach (string regRoot in ProbeRegistryDesktopDirs())
            {
                AddCandidate(regRoot, "Registry");
            }

            // 3. Common Desktop install directories
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

            string[] commonDirs =
            {
                Path.Combine(localAppData, "Programs", "antigravity"),
                Path.Combine(localAppData, "Programs", "Antigravity"),
                Path.Combine(localAppData, "Programs", "Google", "Antigravity"),
                Path.Combine(programFiles, "Antigravity"),
                Path.Combine(programFilesX86, "Antigravity")
            };
            foreach (string dir in commonDirs)
            {
                AddCandidate(dir, "Default");
            }

            var results = new List<DesktopInstallInfo>();
            bool running = IsAntigravityRunning();
            bool isAdmin = IsAdministrator();

            foreach (var (rootDir, source) in candidates)
            {
                var info = InspectDesktopDirectory(rootDir, source, contract, running, isAdmin);
                if (info.HasAsar || string.Equals(source, "Selected", StringComparison.Ordinal))
                {
                    results.Add(info);
                }
            }

            return results;
        }

        public static DesktopInstallInfo InspectDesktopDirectory(
            string pathInput,
            string source,
            ContractData contract,
            bool? isRunningOverride = null,
            bool? isAdminOverride = null)
        {
            string normalized = NormalizeDesktopRoot(pathInput);

            string resourcesDir = Path.Combine(normalized, "resources");
            string exePath = Path.Combine(normalized, "Antigravity.exe");
            string asarPath = Path.Combine(resourcesDir, "app.asar");
            string backupPath = Path.Combine(resourcesDir, "app.asar.backup");

            bool hasAsar = File.Exists(asarPath);
            bool isPatched = hasAsar && AsarPatcher.ContainsMarker(asarPath, contract.MarkerMainHook);
            bool hasBackup = File.Exists(backupPath);
            bool running = isRunningOverride ?? IsAntigravityRunning();
            bool isAdmin = isAdminOverride ?? IsAdministrator();

            bool dllExists = File.Exists(Path.Combine(normalized, "version.dll"));
            string configPath = Path.Combine(normalized, "config.json");
            bool configExists = File.Exists(configPath);
            string existingType = "";
            string existingHost = "";
            int existingPort = 0;

            if (configExists)
            {
                try
                {
                    var cfg = JsonHelper.DeserializeObject(File.ReadAllText(configPath, Encoding.UTF8));
                    var proxyObj = JsonHelper.GetObject(cfg, "proxy");
                    if (proxyObj != null)
                    {
                        existingType = JsonHelper.GetString(proxyObj, "type");
                        existingHost = JsonHelper.GetString(proxyObj, "host");
                        existingPort = JsonHelper.GetInt(proxyObj, "port");
                    }
                }
                catch { }
            }

            bool needsElevation = false;
            if (!isAdmin && Directory.Exists(resourcesDir))
            {
                needsElevation = !CanWriteDirectory(resourcesDir);
            }

            return new DesktopInstallInfo
            {
                RootDir = normalized,
                ResourcesDir = resourcesDir,
                ExePath = exePath,
                AsarPath = asarPath,
                BackupPath = backupPath,
                Source = source,
                Exists = Directory.Exists(normalized),
                HasAsar = hasAsar,
                IsPatched = isPatched,
                HasBackup = hasBackup,
                IsRunning = running,
                NeedsElevation = needsElevation,
                ProxyInstalled = dllExists && configExists,
                ExistingProxyType = existingType,
                ExistingProxyHost = existingHost,
                ExistingProxyPort = existingPort
            };
        }

        private static bool CanWriteDirectory(string dirPath)
        {
            string probe = Path.Combine(dirPath, $".antitoken-write-test-{Process.GetCurrentProcess().Id}.tmp");
            try
            {
                using (var fs = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    fs.WriteByte(0);
                }
                File.Delete(probe);
                return true;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
            catch
            {
                return true;
            }
            finally
            {
                if (File.Exists(probe))
                {
                    try { File.Delete(probe); } catch { }
                }
            }
        }

        private static IEnumerable<string> ProbeRegistryDesktopDirs()
        {
            var roots = new[]
            {
                (RegistryHive.CurrentUser, RegistryView.Default, @"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
                (RegistryHive.LocalMachine, RegistryView.Registry64, @"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
                (RegistryHive.LocalMachine, RegistryView.Registry32, @"Software\Microsoft\Windows\CurrentVersion\Uninstall")
            };

            var found = new List<string>();
            foreach (var (hive, view, subKeyPath) in roots)
            {
                try
                {
                    using (var baseKey = RegistryKey.OpenBaseKey(hive, view))
                    using (var uninstall = baseKey.OpenSubKey(subKeyPath))
                    {
                        if (uninstall == null) continue;
                        foreach (string name in uninstall.GetSubKeyNames())
                        {
                            try
                            {
                                using (var sub = uninstall.OpenSubKey(name))
                                {
                                    if (sub == null) continue;
                                    string displayName = sub.GetValue("DisplayName") as string ?? "";
                                    if (displayName.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) < 0) continue;
                                    if (displayName.IndexOf("Antigravity IDE", StringComparison.OrdinalIgnoreCase) >= 0) continue;

                                    foreach (string valName in new[] { "InstallLocation", "DisplayIcon", "UninstallString" })
                                    {
                                        string raw = sub.GetValue(valName) as string;
                                        string dir = ExtractDirectoryFromRegistryValue(raw);
                                        if (!string.IsNullOrEmpty(dir))
                                        {
                                            found.Add(dir);
                                        }
                                    }
                                }
                            }
                            catch { }
                        }
                    }
                }
                catch { }
            }
            return found;
        }

        private static string ExtractDirectoryFromRegistryValue(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            string cleaned = raw.Trim();
            if (cleaned.StartsWith("\"", StringComparison.Ordinal))
            {
                int endQuote = cleaned.IndexOf('"', 1);
                if (endQuote > 1) cleaned = cleaned.Substring(1, endQuote - 1);
            }
            int commaIdx = cleaned.IndexOf(',');
            if (commaIdx > 0) cleaned = cleaned.Substring(0, commaIdx);
            cleaned = cleaned.Trim();
            if (string.IsNullOrEmpty(cleaned)) return null;

            if (Directory.Exists(cleaned)) return cleaned;
            string parent = Path.GetDirectoryName(cleaned);
            if (!string.IsNullOrEmpty(parent) && Directory.Exists(parent)) return parent;
            return null;
        }

        private static string TryGetProcessPath(int pid)
        {
            IntPtr hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hProcess == IntPtr.Zero) return null;
            try
            {
                int capacity = 1024;
                var sb = new StringBuilder(capacity);
                if (QueryFullProcessImageName(hProcess, 0, sb, ref capacity))
                {
                    return sb.ToString();
                }
                return null;
            }
            finally
            {
                CloseHandle(hProcess);
            }
        }

        private static string TryGetProcessName(int pid)
        {
            if (pid <= 0) return "";
            try
            {
                using (var proc = Process.GetProcessById(pid))
                {
                    return proc.ProcessName;
                }
            }
            catch
            {
                string fullPath = TryGetProcessPath(pid);
                return string.IsNullOrEmpty(fullPath) ? "" : Path.GetFileNameWithoutExtension(fullPath);
            }
        }

        public static async Task<List<ProxyCandidate>> DetectLocalProxiesAsync(int existingConfigPort = 0)
        {
            var systemProxyPorts = GetSystemProxyLoopbackPorts();
            var envProxyPorts = GetEnvProxyLoopbackPorts();
            var listeners = GetLoopbackListeners();

            var candidatePorts = new HashSet<int>();
            foreach (int p in systemProxyPorts) candidatePorts.Add(p);
            foreach (int p in envProxyPorts) candidatePorts.Add(p);
            if (existingConfigPort > 0) candidatePorts.Add(existingConfigPort);
            foreach (int p in CommonProxyPorts) candidatePorts.Add(p);

            foreach (var kv in listeners)
            {
                string pname = kv.Value.ProcessName ?? "";
                if (KnownProxyKeywords.Any(k => pname.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0))
                {
                    candidatePorts.Add(kv.Key);
                }
            }

            List<int> portsToProbe;
            if (listeners.Count > 0)
            {
                portsToProbe = candidatePorts
                    .Where(p => listeners.ContainsKey(p) || systemProxyPorts.Contains(p) || p == existingConfigPort)
                    .ToList();
            }
            else
            {
                portsToProbe = candidatePorts.ToList();
            }

            var probeTasks = portsToProbe.Select(async port =>
            {
                listeners.TryGetValue(port, out var listener);
                bool hasIpv4 = listener == null || listener.IsIpv4;
                bool hasIpv6 = listener != null && listener.IsIpv6;
                string host = hasIpv4 ? "127.0.0.1" : "::1";

                var socksTask = ProbeSocks5Async(host, port, 350);
                var httpTask = ProbeHttpProxyAsync(host, port, 350);
                await Task.WhenAll(socksTask, httpTask).ConfigureAwait(false);

                bool socksOk = socksTask.Result;
                bool httpOk = httpTask.Result;

                if (!socksOk && !httpOk && hasIpv4 && hasIpv6)
                {
                    host = "::1";
                    var socksV6 = ProbeSocks5Async(host, port, 350);
                    var httpV6 = ProbeHttpProxyAsync(host, port, 350);
                    await Task.WhenAll(socksV6, httpV6).ConfigureAwait(false);
                    socksOk = socksV6.Result;
                    httpOk = httpV6.Result;
                    if (!socksOk && !httpOk) host = "127.0.0.1";
                }

                bool isSys = systemProxyPorts.Contains(port);
                bool isExisting = port == existingConfigPort && existingConfigPort > 0;

                if (!socksOk && !httpOk && !isSys && !isExisting)
                {
                    return null;
                }

                return new ProxyCandidate
                {
                    Port = port,
                    Host = host,
                    SupportsSocks5 = socksOk,
                    SupportsHttp = httpOk,
                    ProcessName = listener?.ProcessName ?? "",
                    Pid = listener?.Pid ?? 0,
                    IsSystemProxy = isSys,
                    IsExistingConfig = isExisting
                };
            });

            var probed = await Task.WhenAll(probeTasks).ConfigureAwait(false);
            return probed
                .Where(c => c != null)
                .OrderByDescending(c => c.IsSystemProxy)
                .ThenByDescending(c => c.IsExistingConfig)
                .ThenByDescending(c => KnownProxyKeywords.Any(k => c.ProcessName.IndexOf(k, StringComparison.OrdinalIgnoreCase) >= 0))
                .ThenByDescending(c => c.SupportsSocks5)
                .ThenBy(c => c.Port)
                .ToList();
        }

        private static HashSet<int> GetSystemProxyLoopbackPorts()
        {
            var ports = new HashSet<int>();
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings"))
                {
                    if (key == null) return ports;
                    object enabled = key.GetValue("ProxyEnable");
                    if (!(enabled is int en) || en == 0) return ports;

                    string server = key.GetValue("ProxyServer") as string;
                    if (string.IsNullOrWhiteSpace(server)) return ports;

                    foreach (string part in server.Split(';'))
                    {
                        int port = ExtractLoopbackPort(part);
                        if (port > 0) ports.Add(port);
                    }
                }
            }
            catch { }
            return ports;
        }

        private static HashSet<int> GetEnvProxyLoopbackPorts()
        {
            var ports = new HashSet<int>();
            foreach (string varName in new[] { "ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "all_proxy", "https_proxy", "http_proxy" })
            {
                string val = Environment.GetEnvironmentVariable(varName);
                int port = ExtractLoopbackPort(val);
                if (port > 0) ports.Add(port);
            }
            return ports;
        }

        private static int ExtractLoopbackPort(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return 0;
            string s = raw.Trim();
            int eqIdx = s.IndexOf('=');
            if (eqIdx >= 0) s = s.Substring(eqIdx + 1);

            if (!s.Contains("://")) s = "http://" + s;
            if (Uri.TryCreate(s, UriKind.Absolute, out var uri))
            {
                string host = uri.DnsSafeHost;
                if (string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(host, "::1", StringComparison.OrdinalIgnoreCase))
                {
                    if (uri.Port > 0 && uri.Port <= 65535) return uri.Port;
                }
            }
            var m = Regex.Match(s, @"(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})");
            if (m.Success && int.TryParse(m.Groups[1].Value, out int p) && p > 0 && p <= 65535)
            {
                return p;
            }
            return 0;
        }

        private static Dictionary<int, ListenerInfo> GetLoopbackListeners()
        {
            var map = new Dictionary<int, ListenerInfo>();
            try
            {
                ReadIpv4Listeners(map);
            }
            catch { }
            try
            {
                ReadIpv6Listeners(map);
            }
            catch { }
            return map;
        }

        private static void ReadIpv4Listeners(Dictionary<int, ListenerInfo> map)
        {
            const uint ERROR_INSUFFICIENT_BUFFER = 122;
            int bufferSize = 0;
            GetExtendedTcpTable(IntPtr.Zero, ref bufferSize, true, AF_INET, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_LISTENER, 0);
            if (bufferSize <= 4) return;

            for (int attempt = 0; attempt < 3; attempt++)
            {
                IntPtr tablePtr = Marshal.AllocHGlobal(bufferSize);
                try
                {
                    uint res = GetExtendedTcpTable(tablePtr, ref bufferSize, true, AF_INET, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_LISTENER, 0);
                    if (res == ERROR_INSUFFICIENT_BUFFER) continue;
                    if (res != 0) return;

                    int count = Marshal.ReadInt32(tablePtr);
                    int rowSize = Marshal.SizeOf(typeof(MIB_TCPROW_OWNER_PID));
                    if (4 + count * rowSize > bufferSize) return;

                    IntPtr rowPtr = IntPtr.Add(tablePtr, 4);
                    for (int i = 0; i < count; i++)
                    {
                        var row = (MIB_TCPROW_OWNER_PID)Marshal.PtrToStructure(rowPtr, typeof(MIB_TCPROW_OWNER_PID));
                        rowPtr = IntPtr.Add(rowPtr, rowSize);

                        if (row.state != MIB_TCP_STATE_LISTEN) continue;
                        var ip = new IPAddress(row.localAddr);
                        if (!ip.Equals(IPAddress.Loopback) && !ip.Equals(IPAddress.Any)) continue;

                        int port = row.LocalPort;
                        if (port <= 0) continue;

                        if (!map.TryGetValue(port, out var info))
                        {
                            info = new ListenerInfo
                            {
                                Port = port,
                                Pid = row.owningPid,
                                ProcessName = TryGetProcessName(row.owningPid)
                            };
                            map[port] = info;
                        }
                        info.IsIpv4 = true;
                    }
                    return;
                }
                finally
                {
                    Marshal.FreeHGlobal(tablePtr);
                }
            }
        }

        private static void ReadIpv6Listeners(Dictionary<int, ListenerInfo> map)
        {
            const uint ERROR_INSUFFICIENT_BUFFER = 122;
            int bufferSize = 0;
            GetExtendedTcpTable(IntPtr.Zero, ref bufferSize, true, AF_INET6, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_LISTENER, 0);
            if (bufferSize <= 4) return;

            for (int attempt = 0; attempt < 3; attempt++)
            {
                IntPtr tablePtr = Marshal.AllocHGlobal(bufferSize);
                try
                {
                    uint res = GetExtendedTcpTable(tablePtr, ref bufferSize, true, AF_INET6, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_LISTENER, 0);
                    if (res == ERROR_INSUFFICIENT_BUFFER) continue;
                    if (res != 0) return;

                    int count = Marshal.ReadInt32(tablePtr);
                    int rowSize = Marshal.SizeOf(typeof(MIB_TCP6ROW_OWNER_PID));
                    if (4 + count * rowSize > bufferSize) return;

                    IntPtr rowPtr = IntPtr.Add(tablePtr, 4);
                    for (int i = 0; i < count; i++)
                    {
                        var row = (MIB_TCP6ROW_OWNER_PID)Marshal.PtrToStructure(rowPtr, typeof(MIB_TCP6ROW_OWNER_PID));
                        rowPtr = IntPtr.Add(rowPtr, rowSize);

                        if (row.dwState != MIB_TCP_STATE_LISTEN) continue;
                        var ip = new IPAddress(row.ucLocalAddr);
                        if (!ip.Equals(IPAddress.IPv6Loopback) && !ip.Equals(IPAddress.IPv6Any)) continue;

                        int port = row.LocalPort;
                        if (port <= 0) continue;

                        if (!map.TryGetValue(port, out var info))
                        {
                            info = new ListenerInfo
                            {
                                Port = port,
                                Pid = row.dwOwningPid,
                                ProcessName = TryGetProcessName(row.dwOwningPid)
                            };
                            map[port] = info;
                        }
                        info.IsIpv6 = true;
                    }
                    return;
                }
                finally
                {
                    Marshal.FreeHGlobal(tablePtr);
                }
            }
        }

        private static TcpClient CreateTcpClientForHost(string host)
        {
            if (IPAddress.TryParse(host, out var ip))
            {
                return new TcpClient(ip.AddressFamily);
            }
            if (Socket.OSSupportsIPv6)
            {
                var client = new TcpClient(AddressFamily.InterNetworkV6);
                client.Client.DualMode = true;
                return client;
            }
            return new TcpClient();
        }

        private static async Task<bool> ProbeSocks5Async(string host, int port, int timeoutMs)
        {
            try
            {
                using (var cts = new CancellationTokenSource(timeoutMs))
                using (var client = CreateTcpClientForHost(host))
                {
                    var connectTask = client.ConnectAsync(host, port);
                    if (await Task.WhenAny(connectTask, Task.Delay(timeoutMs, cts.Token)).ConfigureAwait(false) != connectTask)
                    {
                        return false;
                    }
                    await connectTask.ConfigureAwait(false);

                    var stream = client.GetStream();
                    byte[] greeting = { 0x05, 0x01, 0x00 };
                    await stream.WriteAsync(greeting, 0, greeting.Length, cts.Token).ConfigureAwait(false);

                    byte[] resp = new byte[2];
                    int read = await ReadExactWithTimeoutAsync(stream, resp, 2, cts.Token).ConfigureAwait(false);
                    return read == 2 && resp[0] == 0x05 && resp[1] == 0x00;
                }
            }
            catch
            {
                return false;
            }
        }

        private static async Task<bool> ProbeHttpProxyAsync(string host, int port, int timeoutMs)
        {
            try
            {
                using (var cts = new CancellationTokenSource(timeoutMs))
                using (var client = CreateTcpClientForHost(host))
                {
                    var connectTask = client.ConnectAsync(host, port);
                    if (await Task.WhenAny(connectTask, Task.Delay(timeoutMs, cts.Token)).ConfigureAwait(false) != connectTask)
                    {
                        return false;
                    }
                    await connectTask.ConfigureAwait(false);

                    var stream = client.GetStream();
                    byte[] req = Encoding.ASCII.GetBytes("CONNECT 127.0.0.1:0 HTTP/1.1\r\nHost: 127.0.0.1:0\r\nConnection: close\r\n\r\n");
                    await stream.WriteAsync(req, 0, req.Length, cts.Token).ConfigureAwait(false);

                    byte[] resp = new byte[12];
                    int read = await ReadExactWithTimeoutAsync(stream, resp, 7, cts.Token).ConfigureAwait(false);
                    if (read < 7) return false;
                    string prefix = Encoding.ASCII.GetString(resp, 0, read);
                    return prefix.StartsWith("HTTP/1.", StringComparison.OrdinalIgnoreCase);
                }
            }
            catch
            {
                return false;
            }
        }

        public static async Task<ProxyTestResult> TestProxyAsync(string host, int port, string type, int timeoutMs = 4000)
        {
            string normalizedHost = string.IsNullOrWhiteSpace(host) ? "127.0.0.1" : host.Trim();
            string normalizedType = string.Equals(type, "http", StringComparison.OrdinalIgnoreCase) ? "http" : "socks5";
            const string targetHost = "oauth2.googleapis.com";
            const int targetPort = 443;

            var sw = Stopwatch.StartNew();
            try
            {
                using (var cts = new CancellationTokenSource(timeoutMs))
                using (var client = CreateTcpClientForHost(normalizedHost))
                {
                    var connectTask = client.ConnectAsync(normalizedHost, port);
                    if (await Task.WhenAny(connectTask, Task.Delay(timeoutMs, cts.Token)).ConfigureAwait(false) != connectTask)
                    {
                        return new ProxyTestResult
                        {
                            Ok = false,
                            TotalLatencyMs = sw.ElapsedMilliseconds,
                            Message = $"Connection timed out after {timeoutMs}ms ({normalizedHost}:{port})."
                        };
                    }
                    await connectTask.ConfigureAwait(false);
                    long connectMs = sw.ElapsedMilliseconds;
                    var stream = client.GetStream();

                    if (normalizedType == "socks5")
                    {
                        byte[] greeting = { 0x05, 0x01, 0x00 };
                        await stream.WriteAsync(greeting, 0, greeting.Length, cts.Token).ConfigureAwait(false);
                        byte[] greetResp = new byte[2];
                        int r1 = await ReadExactWithTimeoutAsync(stream, greetResp, 2, cts.Token).ConfigureAwait(false);
                        if (r1 < 2 || greetResp[0] != 0x05 || greetResp[1] != 0x00)
                        {
                            return new ProxyTestResult
                            {
                                Ok = false,
                                ConnectLatencyMs = connectMs,
                                TotalLatencyMs = sw.ElapsedMilliseconds,
                                Message = r1 < 2
                                    ? "SOCKS5 handshake closed unexpectedly."
                                    : $"SOCKS5 handshake rejected: [{greetResp[0]}, {greetResp[1]}]."
                            };
                        }

                        byte[] hostBytes = Encoding.ASCII.GetBytes(targetHost);
                        byte[] req = new byte[7 + hostBytes.Length];
                        req[0] = 0x05;
                        req[1] = 0x01;
                        req[2] = 0x00;
                        req[3] = 0x03;
                        req[4] = (byte)hostBytes.Length;
                        Buffer.BlockCopy(hostBytes, 0, req, 5, hostBytes.Length);
                        req[5 + hostBytes.Length] = (byte)(targetPort >> 8);
                        req[6 + hostBytes.Length] = (byte)(targetPort & 0xFF);
                        await stream.WriteAsync(req, 0, req.Length, cts.Token).ConfigureAwait(false);

                        byte[] connResp = new byte[10];
                        int r2 = await ReadExactWithTimeoutAsync(stream, connResp, 2, cts.Token).ConfigureAwait(false);
                        if (r2 < 2 && cts.IsCancellationRequested)
                        {
                            return new ProxyTestResult
                            {
                                Ok = false,
                                ConnectLatencyMs = connectMs,
                                TotalLatencyMs = sw.ElapsedMilliseconds,
                                Message = $"SOCKS5 tunnel timed out after {timeoutMs}ms."
                            };
                        }
                        if (r2 >= 2 && connResp[0] == 0x05 && connResp[1] == 0x00)
                        {
                            return new ProxyTestResult
                            {
                                Ok = true,
                                ConnectLatencyMs = connectMs,
                                TotalLatencyMs = sw.ElapsedMilliseconds,
                                Message = $"SOCKS5 tunnel to {targetHost}:{targetPort} OK ({sw.ElapsedMilliseconds} ms)"
                            };
                        }
                        return new ProxyTestResult
                        {
                            Ok = false,
                            ConnectLatencyMs = connectMs,
                            TotalLatencyMs = sw.ElapsedMilliseconds,
                            Message = r2 >= 2
                                ? $"SOCKS5 tunnel failed (REP={connResp[1]})."
                                : "SOCKS5 tunnel closed without response."
                        };
                    }
                    else
                    {
                        string connectReq = $"CONNECT {targetHost}:{targetPort} HTTP/1.1\r\nHost: {targetHost}:{targetPort}\r\nUser-Agent: AntigravityProxyCheck/1.0\r\n\r\n";
                        byte[] reqBytes = Encoding.ASCII.GetBytes(connectReq);
                        await stream.WriteAsync(reqBytes, 0, reqBytes.Length, cts.Token).ConfigureAwait(false);

                        byte[] respBuf = new byte[512];
                        var (r, gotNewline) = await ReadLineWithTimeoutAsync(stream, respBuf, cts.Token).ConfigureAwait(false);
                        if (!gotNewline && cts.IsCancellationRequested)
                        {
                            return new ProxyTestResult
                            {
                                Ok = false,
                                ConnectLatencyMs = connectMs,
                                TotalLatencyMs = sw.ElapsedMilliseconds,
                                Message = $"HTTP CONNECT timed out after {timeoutMs}ms."
                            };
                        }
                        string respStr = Encoding.ASCII.GetString(respBuf, 0, r);
                        string firstLine = respStr.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)[0];
                        if (firstLine.StartsWith("HTTP/1.1 200", StringComparison.OrdinalIgnoreCase) ||
                            firstLine.StartsWith("HTTP/1.0 200", StringComparison.OrdinalIgnoreCase))
                        {
                            return new ProxyTestResult
                            {
                                Ok = true,
                                ConnectLatencyMs = connectMs,
                                TotalLatencyMs = sw.ElapsedMilliseconds,
                                Message = $"HTTP CONNECT to {targetHost}:{targetPort} OK ({sw.ElapsedMilliseconds} ms)"
                            };
                        }
                        return new ProxyTestResult
                        {
                            Ok = false,
                            ConnectLatencyMs = connectMs,
                            TotalLatencyMs = sw.ElapsedMilliseconds,
                            Message = string.IsNullOrEmpty(firstLine)
                                ? "HTTP proxy returned empty response."
                                : $"HTTP proxy error: {firstLine}"
                        };
                    }
                }
            }
            catch (Exception ex)
            {
                return new ProxyTestResult
                {
                    Ok = false,
                    TotalLatencyMs = sw.ElapsedMilliseconds,
                    Message = $"Failed to connect to {normalizedHost}:{port}: {ex.Message}"
                };
            }
        }

        private static async Task<int> ReadExactWithTimeoutAsync(NetworkStream stream, byte[] buffer, int count, CancellationToken token)
        {
            int total = 0;
            while (total < count)
            {
                var readTask = stream.ReadAsync(buffer, total, count - total, token);
                var delayTask = Task.Delay(Timeout.Infinite, token);
                if (await Task.WhenAny(readTask, delayTask).ConfigureAwait(false) != readTask)
                {
                    return total;
                }
                int r = await readTask.ConfigureAwait(false);
                if (r <= 0) return total;
                total += r;
            }
            return total;
        }

        private static async Task<(int Total, bool GotNewline)> ReadLineWithTimeoutAsync(NetworkStream stream, byte[] buffer, CancellationToken token)
        {
            int total = 0;
            while (total < buffer.Length)
            {
                var readTask = stream.ReadAsync(buffer, total, buffer.Length - total, token);
                var delayTask = Task.Delay(Timeout.Infinite, token);
                if (await Task.WhenAny(readTask, delayTask).ConfigureAwait(false) != readTask)
                {
                    return (total, false);
                }
                int r = await readTask.ConfigureAwait(false);
                if (r <= 0) return (total, false);
                int end = total + r;
                for (int i = total; i < end; i++)
                {
                    if (buffer[i] == (byte)'\n')
                    {
                        return (end, true);
                    }
                }
                total = end;
            }
            return (total, false);
        }
    }
}
