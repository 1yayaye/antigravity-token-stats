using System;
using System.IO;
using System.Text;

namespace AntiTokenSetup.Services
{
    public static class ProxyInstaller
    {
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        public static void Install(string appRootDir, string host, int port, string type, Action<string> log = null)
        {
            if (string.IsNullOrWhiteSpace(appRootDir) || !Directory.Exists(appRootDir))
            {
                throw new DirectoryNotFoundException($"Antigravity directory not found: {appRootDir}");
            }
            if (port < 1 || port > 65535)
            {
                throw new ArgumentOutOfRangeException(nameof(port), $"Invalid proxy port: {port}");
            }

            string normalizedHost = string.IsNullOrWhiteSpace(host) ? "127.0.0.1" : host.Trim();
            string normalizedType = string.Equals(type, "http", StringComparison.OrdinalIgnoreCase) ? "http" : "socks5";

            byte[] embeddedDll = EmbeddedAssets.ReadBytes("version.dll");
            string embeddedHash = EmbeddedAssets.ComputeSha256Hex(embeddedDll);

            string targetDll = Path.Combine(appRootDir, "version.dll");
            bool needsDllCopy = true;
            if (File.Exists(targetDll))
            {
                try
                {
                    if (string.Equals(EmbeddedAssets.ComputeFileSha256Hex(targetDll), embeddedHash, StringComparison.Ordinal))
                    {
                        needsDllCopy = false;
                        log?.Invoke("   ✓ version.dll already matches embedded binary (skipped overwrite).");
                    }
                }
                catch { }
            }

            if (needsDllCopy)
            {
                string tempDll = $"{targetDll}.tmp-{Guid.NewGuid():N}";
                try
                {
                    File.WriteAllBytes(tempDll, embeddedDll);
                    if (!string.Equals(EmbeddedAssets.ComputeFileSha256Hex(tempDll), embeddedHash, StringComparison.Ordinal))
                    {
                        throw new IOException("SHA256 verification failed while staging version.dll.");
                    }
                    AsarPatcher.ReplaceFileAtomic(tempDll, targetDll);
                }
                finally
                {
                    if (File.Exists(tempDll))
                    {
                        try { File.Delete(tempDll); } catch { }
                    }
                }
                log?.Invoke($"   ✓ Deployed version.dll -> {targetDll}");
            }

            string templateJson = EmbeddedAssets.ReadText("proxy-config-template.json");
            var templateConfig = JsonHelper.DeserializeObject(templateJson);
            string targetConfig = Path.Combine(appRootDir, "config.json");

            System.Collections.Generic.Dictionary<string, object> config = null;
            if (File.Exists(targetConfig))
            {
                try
                {
                    var existing = JsonHelper.DeserializeObject(File.ReadAllText(targetConfig, Encoding.UTF8));
                    if (existing != null && existing.Count > 0)
                    {
                        config = existing;
                        config["_managed_by"] = JsonHelper.GetString(templateConfig, "_managed_by", "antigravity-token-stats");
                        string templateVersion = JsonHelper.GetString(templateConfig, "_version");
                        if (!string.IsNullOrEmpty(templateVersion))
                        {
                            config["_version"] = templateVersion;
                        }
                    }
                }
                catch { }
            }
            if (config == null)
            {
                config = templateConfig;
            }

            var proxyObj = JsonHelper.GetObject(config, "proxy");
            if (proxyObj == null)
            {
                proxyObj = new System.Collections.Generic.Dictionary<string, object>(StringComparer.Ordinal);
                config["proxy"] = proxyObj;
            }
            proxyObj["type"] = normalizedType;
            proxyObj["host"] = normalizedHost;
            proxyObj["port"] = port;

            string tempConfig = $"{targetConfig}.tmp-{Guid.NewGuid():N}";
            try
            {
                File.WriteAllText(tempConfig, JsonHelper.SerializePretty(config), Utf8NoBom);
                AsarPatcher.ReplaceFileAtomic(tempConfig, targetConfig);
            }
            finally
            {
                if (File.Exists(tempConfig))
                {
                    try { File.Delete(tempConfig); } catch { }
                }
            }
            log?.Invoke($"   ✓ Wrote proxy config ({normalizedType}://{normalizedHost}:{port}) -> {targetConfig}");
        }

        public static bool Uninstall(string appRootDir, Action<string> log = null)
        {
            if (string.IsNullOrWhiteSpace(appRootDir) || !Directory.Exists(appRootDir))
            {
                return false;
            }

            bool removedAny = false;
            string targetDll = Path.Combine(appRootDir, "version.dll");
            string targetConfig = Path.Combine(appRootDir, "config.json");

            if (File.Exists(targetDll))
            {
                var attrs = File.GetAttributes(targetDll);
                if ((attrs & FileAttributes.ReadOnly) != 0)
                {
                    File.SetAttributes(targetDll, attrs & ~FileAttributes.ReadOnly);
                }
                File.Delete(targetDll);
                removedAny = true;
                log?.Invoke($"   ✓ Removed {targetDll}");
            }

            if (File.Exists(targetConfig))
            {
                var attrs = File.GetAttributes(targetConfig);
                if ((attrs & FileAttributes.ReadOnly) != 0)
                {
                    File.SetAttributes(targetConfig, attrs & ~FileAttributes.ReadOnly);
                }
                File.Delete(targetConfig);
                removedAny = true;
                log?.Invoke($"   ✓ Removed {targetConfig}");
            }

            return removedAny;
        }
    }
}
