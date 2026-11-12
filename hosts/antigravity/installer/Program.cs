using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using AntiTokenSetup.Models;
using AntiTokenSetup.Services;
using AntiTokenSetup.UI;

namespace AntiTokenSetup
{
    internal static class Program
    {
        private const int ATTACH_PARENT_PROCESS = -1;
        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(int dwProcessId);

        [STAThread]
        static int Main(string[] args)
        {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);

            var contract = EmbeddedAssets.LoadContract();

            if (HasCliAction(args))
            {
                if (!Console.IsOutputRedirected)
                {
                    AttachConsole(ATTACH_PARENT_PROCESS);
                }
                return RunCli(args, contract);
            }

            try
            {
                if (Environment.OSVersion.Version.Major >= 10)
                {
                    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                }
            }
            catch { }

            string initialDir = GetArgValue(args, "--dir");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(contract, initialDir));
            return 0;
        }

        private static bool HasCliAction(string[] args)
        {
            foreach (string a in args)
            {
                if (a == "--no-gui" || a == "--help" || a == "-h" ||
                    a == "--detect-proxies" || a == "--test-proxy" ||
                    a == "--patch-dir" || a.StartsWith("--patch-dir=", StringComparison.Ordinal) ||
                    a == "--unpatch-dir" || a.StartsWith("--unpatch-dir=", StringComparison.Ordinal) ||
                    a == "--verify-asar" || a.StartsWith("--verify-asar=", StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        private static int RunCli(string[] args, ContractData contract)
        {
            try
            {
                if (HasFlag(args, "--help") || HasFlag(args, "-h"))
                {
                    Console.WriteLine("AntiTokenSetup CLI Usage:");
                    Console.WriteLine("  --patch-dir <resourcesDir> [--no-proxy] [--proxy-port <port>] [--proxy-type <socks5|http>] [--kill] [--min-asar-size <bytes>] [--dev-bundle <path>] [--skip-dev-redirect] --no-gui");
                    Console.WriteLine("  --unpatch-dir <resourcesDir> [--no-proxy] [--kill] [--dev-bundle <path>] [--skip-dev-redirect] --no-gui");
                    Console.WriteLine("  --verify-asar <asarPath> [--require-patched]");
                    Console.WriteLine("  --detect-proxies");
                    Console.WriteLine("  --test-proxy [--proxy-host <host>] --proxy-port <port> [--proxy-type <socks5|http>]");
                    return 0;
                }

                if (HasFlag(args, "--test-proxy"))
                {
                    string host = GetArgValue(args, "--proxy-host") ?? "127.0.0.1";
                    int port = 7890;
                    string portArg = GetArgValue(args, "--proxy-port");
                    if (!string.IsNullOrEmpty(portArg)) int.TryParse(portArg, out port);
                    string type = GetArgValue(args, "--proxy-type") ?? "socks5";
                    var result = EnvironmentDetector.TestProxyAsync(host, port, type).GetAwaiter().GetResult();
                    var payload = new System.Collections.Generic.Dictionary<string, object>
                    {
                        ["ok"] = result.Ok,
                        ["message"] = result.Message,
                        ["connectLatencyMs"] = result.ConnectLatencyMs,
                        ["totalLatencyMs"] = result.TotalLatencyMs
                    };
                    Console.WriteLine(JsonHelper.SerializeCompact(payload));
                    return result.Ok ? 0 : 1;
                }

                if (HasFlag(args, "--detect-proxies"))
                {
                    int extraPort = 0;
                    string portArg = GetArgValue(args, "--proxy-port");
                    if (!string.IsNullOrEmpty(portArg)) int.TryParse(portArg, out extraPort);
                    var proxies = EnvironmentDetector.DetectLocalProxiesAsync(extraPort).GetAwaiter().GetResult();
                    var payload = new System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object>>();
                    foreach (var p in proxies)
                    {
                        payload.Add(new System.Collections.Generic.Dictionary<string, object>
                        {
                            ["port"] = p.Port,
                            ["host"] = p.Host,
                            ["socks5"] = p.SupportsSocks5,
                            ["http"] = p.SupportsHttp,
                            ["pid"] = p.Pid,
                            ["processName"] = p.ProcessName,
                            ["isSystemProxy"] = p.IsSystemProxy,
                            ["isExistingConfig"] = p.IsExistingConfig
                        });
                    }
                    Console.WriteLine(JsonHelper.SerializeCompact(payload));
                    return 0;
                }

                string verifyAsar = GetArgValue(args, "--verify-asar");
                if (!string.IsNullOrEmpty(verifyAsar))
                {
                    bool requirePatched = HasFlag(args, "--require-patched");
                    AsarPatcher.VerifyAsar(verifyAsar, contract, requirePatched, verifyAllHashes: true);
                    Console.WriteLine($"OK: Verified ASAR integrity: {verifyAsar}");
                    return 0;
                }

                bool killRunning = HasFlag(args, "--kill");
                if (killRunning && EnvironmentDetector.IsAntigravityRunning())
                {
                    Console.WriteLine("Stopping running Antigravity.exe...");
                    EnvironmentDetector.StopAntigravityProcesses(5000);
                }

                bool noProxy = HasFlag(args, "--no-proxy");
                bool skipDevRedirect = HasFlag(args, "--skip-dev-redirect");
                string devBundleOverride = GetArgValue(args, "--dev-bundle");

                string patchDir = GetArgValue(args, "--patch-dir");
                if (!string.IsNullOrEmpty(patchDir))
                {
                    string normalizedPatchDir = EnvironmentDetector.NormalizeDirectoryPath(patchDir);
                    long minSize = 3L * 1024 * 1024;
                    string minSizeArg = GetArgValue(args, "--min-asar-size");
                    if (!string.IsNullOrEmpty(minSizeArg) && long.TryParse(minSizeArg, out long parsedMin))
                    {
                        minSize = parsedMin;
                    }

                    var res = AsarPatcher.Patch(
                        normalizedPatchDir,
                        contract,
                        minAsarSize: minSize,
                        skipDevRedirect: skipDevRedirect,
                        devBundleOverride: devBundleOverride,
                        log: Console.WriteLine);

                    if (!noProxy)
                    {
                        int port = 7890;
                        string portArg = GetArgValue(args, "--proxy-port");
                        if (!string.IsNullOrEmpty(portArg) && int.TryParse(portArg, out int p)) port = p;
                        string host = GetArgValue(args, "--proxy-host") ?? "127.0.0.1";
                        string type = GetArgValue(args, "--proxy-type") ?? "socks5";
                        string rootDir = Path.GetDirectoryName(normalizedPatchDir);
                        ProxyInstaller.Install(rootDir, host, port, type, Console.WriteLine);
                    }

                    Console.WriteLine($"SUCCESS: Patched {res.AsarPath} ({res.SizeBytes} bytes, backupCreated={res.BackupCreated})");
                    return 0;
                }

                string unpatchDir = GetArgValue(args, "--unpatch-dir");
                if (!string.IsNullOrEmpty(unpatchDir))
                {
                    string normalizedUnpatchDir = EnvironmentDetector.NormalizeDirectoryPath(unpatchDir);
                    var res = AsarPatcher.Unpatch(
                        normalizedUnpatchDir,
                        contract,
                        removeProxy: !noProxy,
                        skipDevRedirect: skipDevRedirect,
                        devBundleOverride: devBundleOverride,
                        log: Console.WriteLine);

                    Console.WriteLine($"SUCCESS: Unpatched (restored={res.Restored}, pristine={res.Pristine}, proxyRemoved={res.ProxyRemoved})");
                    return res.Pristine ? 0 : 1;
                }

                Console.Error.WriteLine("No CLI action specified. Use --help for usage.");
                return 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"ERROR: {ex.Message}");
                return 1;
            }
        }

        private static bool HasFlag(string[] args, string flag)
        {
            foreach (string a in args)
            {
                if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static string GetArgValue(string[] args, string name)
        {
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase))
                {
                    return a.Substring(name.Length + 1);
                }
                if (string.Equals(a, name, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    return args[i + 1];
                }
            }
            return null;
        }
    }
}
