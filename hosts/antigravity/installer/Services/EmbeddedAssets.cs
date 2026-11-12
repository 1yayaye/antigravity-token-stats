using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using AntiTokenSetup.Models;

namespace AntiTokenSetup.Services
{
    public static class EmbeddedAssets
    {
        private const string Prefix = "AntiTokenSetup.Assets.";
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        public static byte[] ReadBytes(string assetName)
        {
            var assembly = Assembly.GetExecutingAssembly();
            string resourceName = Prefix + assetName;
            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                {
                    throw new FileNotFoundException($"Embedded asset not found: {resourceName}");
                }

                byte[] buffer = new byte[stream.Length];
                int offset = 0;
                while (offset < buffer.Length)
                {
                    int read = stream.Read(buffer, offset, buffer.Length - offset);
                    if (read == 0) break;
                    offset += read;
                }
                return buffer;
            }
        }

        public static string ReadText(string assetName)
        {
            byte[] bytes = ReadBytes(assetName);
            return Utf8NoBom.GetString(bytes);
        }

        public static ContractData LoadContract()
        {
            string json = ReadText("contract.json");
            var dict = JsonHelper.DeserializeObject(json);
            return new ContractData
            {
                Version = JsonHelper.GetString(dict, "version", "1.5.0"),
                MarkerMainHook = JsonHelper.GetString(dict, "MARKER_MAIN_HOOK", "__ANTIGRAVITY_STATS_INJECTION__"),
                MarkerPreloadBridge = JsonHelper.GetString(dict, "MARKER_PRELOAD_BRIDGE", "__ANTIGRAVITY_STATS_PRELOAD_BRIDGE__"),
                WindowSyncBridge = JsonHelper.GetString(dict, "WINDOW_SYNC_BRIDGE", "__ANTIGRAVITY_SYNC_BRIDGE__"),
                IpcRequestSync = JsonHelper.GetString(dict, "IPC_REQUEST_SYNC", "antigravity:request-sync")
            };
        }

        public static string ComputeSha256Hex(byte[] data)
        {
            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(data);
                return ToLowerHex(hash);
            }
        }

        public static string ComputeFileSha256Hex(string filePath)
        {
            using (var sha = SHA256.Create())
            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                byte[] hash = sha.ComputeHash(fs);
                return ToLowerHex(hash);
            }
        }

        public static string ToLowerHex(byte[] bytes)
        {
            var chars = new char[bytes.Length * 2];
            const string hex = "0123456789abcdef";
            for (int i = 0; i < bytes.Length; i++)
            {
                byte b = bytes[i];
                chars[i * 2] = hex[b >> 4];
                chars[i * 2 + 1] = hex[b & 0x0F];
            }
            return new string(chars);
        }
    }
}
