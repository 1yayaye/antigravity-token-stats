using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using AntiTokenSetup.Models;

namespace AntiTokenSetup.Services
{
    public static class AsarPatcher
    {
        private const int IntegrityBlockSize = 4 * 1024 * 1024;
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        private static readonly string[] InjectedAssetNames =
        {
            "loader.cjs",
            "update-checker.cjs",
            "contract.json",
            "aggregate-stats.cjs",
            "paths.cjs",
            "injection-contract.cjs",
            "proxy-manager.cjs",
            "antigravity-stats-bundle.js"
        };

        private sealed class WriteSpan
        {
            public long SourceOffset;
            public long Length;
            public byte[] MemoryBytes;
        }

        public static bool ContainsMarker(string filePath, string marker)
        {
            if (!File.Exists(filePath)) return false;
            byte[] pattern = Utf8NoBom.GetBytes(marker);
            if (pattern.Length == 0) return false;

            const int chunkSize = 1024 * 1024;
            int overlap = pattern.Length - 1;
            byte[] buffer = new byte[chunkSize + overlap];
            int carry = 0;

            using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                while (true)
                {
                    int read = fs.Read(buffer, carry, chunkSize);
                    if (read <= 0) break;
                    int total = carry + read;
                    if (IndexOfBytes(buffer, total, pattern) >= 0)
                    {
                        return true;
                    }
                    if (total >= overlap)
                    {
                        Buffer.BlockCopy(buffer, total - overlap, buffer, 0, overlap);
                        carry = overlap;
                    }
                    else
                    {
                        carry = total;
                    }
                }
            }
            return false;
        }

        private static int IndexOfBytes(byte[] haystack, int haystackLen, byte[] needle)
        {
            int limit = haystackLen - needle.Length;
            for (int i = 0; i <= limit; i++)
            {
                bool match = true;
                for (int j = 0; j < needle.Length; j++)
                {
                    if (haystack[i + j] != needle[j])
                    {
                        match = false;
                        break;
                    }
                }
                if (match) return i;
            }
            return -1;
        }

        public static PatchResult Patch(
            string resourcesDir,
            ContractData contract,
            long minAsarSize = 3L * 1024 * 1024,
            bool skipDevRedirect = false,
            string devBundleOverride = null,
            Action<string> log = null)
        {
            resourcesDir = EnvironmentDetector.NormalizeDirectoryPath(resourcesDir);
            string asarPath = Path.Combine(resourcesDir, "app.asar");
            string backupPath = Path.Combine(resourcesDir, "app.asar.backup");

            if (!File.Exists(asarPath))
            {
                throw new FileNotFoundException($"Target app.asar not found at: {asarPath}");
            }

            bool alreadyModified = ContainsMarker(asarPath, contract.MarkerMainHook);
            bool backupCreated = false;
            bool backupRefreshed = false;

            if (!alreadyModified)
            {
                log?.Invoke(File.Exists(backupPath)
                    ? "[1/4] Existing backup found; will refresh after validating app.asar..."
                    : "[1/4] Preparing factory backup (after validating app.asar)...");
            }
            else if (File.Exists(backupPath))
            {
                log?.Invoke("[1/4] Verified existing factory backup: app.asar.backup");
            }
            else
            {
                log?.Invoke("[1/4] Notice: app.asar is already patched and no backup was found; updating hooks in place.");
            }

            log?.Invoke("[2/4] Reading app.asar index and injecting hooks...");
            string tempAsarPath = $"{asarPath}.tmp.{DateTime.UtcNow.Ticks}";

            try
            {
                using (var srcFs = new FileStream(asarPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    var (root, dataBaseOffset) = ReadArchiveHeader(srcFs);

                    var rootFiles = JsonHelper.GetObject(root, "files");
                    if (rootFiles == null)
                    {
                        throw new InvalidDataException("Invalid app.asar header: missing root 'files' object.");
                    }

                    var distNode = JsonHelper.GetObject(rootFiles, "dist");
                    var distFiles = JsonHelper.GetObject(distNode, "files");
                    if (distFiles == null)
                    {
                        throw new InvalidDataException("Expected 'dist/' directory inside app.asar.");
                    }

                    var mainNode = JsonHelper.GetObject(distFiles, "main.js");
                    var preloadNode = JsonHelper.GetObject(distFiles, "preload.js");
                    if (mainNode == null || preloadNode == null)
                    {
                        throw new InvalidDataException("Expected 'dist/main.js' and 'dist/preload.js' inside app.asar.");
                    }

                    byte[] mainOrigBytes = ReadFileBytesFromArchive(srcFs, dataBaseOffset, mainNode, "dist/main.js");
                    byte[] preloadOrigBytes = ReadFileBytesFromArchive(srcFs, dataBaseOffset, preloadNode, "dist/preload.js");

                    string mainPatched = InjectMainHook(Utf8NoBom.GetString(mainOrigBytes), contract);
                    string preloadPatched = InjectPreloadHook(Utf8NoBom.GetString(preloadOrigBytes), contract);

                    byte[] mainPatchedBytes = Utf8NoBom.GetBytes(mainPatched);
                    byte[] preloadPatchedBytes = Utf8NoBom.GetBytes(preloadPatched);

                    // Prepare injected files map for dist/antigravity-stats/
                    var injectedMap = new Dictionary<string, byte[]>(StringComparer.Ordinal);
                    foreach (string assetName in InjectedAssetNames)
                    {
                        injectedMap[assetName] = EmbeddedAssets.ReadBytes(assetName);
                    }

                    // Update dist/main.js and dist/preload.js entries in place, and populate dist/antigravity-stats/
                    var replacedInDist = new Dictionary<string, byte[]>(StringComparer.Ordinal)
                    {
                        ["main.js"] = mainPatchedBytes,
                        ["preload.js"] = preloadPatchedBytes
                    };

                    if (!distFiles.TryGetValue("antigravity-stats", out object statsDirObj) || !(statsDirObj is Dictionary<string, object> statsDirNode))
                    {
                        statsDirNode = new Dictionary<string, object>(StringComparer.Ordinal);
                        distFiles["antigravity-stats"] = statsDirNode;
                    }
                    if (!statsDirNode.TryGetValue("files", out object statsFilesObj) || !(statsFilesObj is Dictionary<string, object> statsFiles))
                    {
                        statsFiles = new Dictionary<string, object>(StringComparer.Ordinal);
                        statsDirNode["files"] = statsFiles;
                    }
                    foreach (string assetName in InjectedAssetNames)
                    {
                        if (!statsFiles.ContainsKey(assetName))
                        {
                            statsFiles[assetName] = new Dictionary<string, object>(StringComparer.Ordinal);
                        }
                    }

                    var spans = new List<WriteSpan>();
                    long currentOffset = 0;
                    var dedupUntouched = new Dictionary<string, string>(StringComparer.Ordinal);
                    var dedupInjected = new Dictionary<string, string>(StringComparer.Ordinal);

                    void WalkAndAssign(Dictionary<string, object> dirFiles, string currentPath)
                    {
                        foreach (var kv in dirFiles)
                        {
                            string entryPath = string.IsNullOrEmpty(currentPath) ? kv.Key : $"{currentPath}/{kv.Key}";
                            if (!(kv.Value is Dictionary<string, object> entry)) continue;

                            if (entry.ContainsKey("link"))
                            {
                                continue;
                            }

                            if (entry.TryGetValue("files", out object subObj) && subObj is Dictionary<string, object> subFiles)
                            {
                                WalkAndAssign(subFiles, entryPath);
                                continue;
                            }

                            if (JsonHelper.GetBool(entry, "unpacked"))
                            {
                                continue;
                            }

                            // Check if this is a replaced or injected file
                            byte[] customBytes = null;
                            if (entryPath == "dist/main.js") customBytes = replacedInDist["main.js"];
                            else if (entryPath == "dist/preload.js") customBytes = replacedInDist["preload.js"];
                            else if (entryPath.StartsWith("dist/antigravity-stats/", StringComparison.Ordinal))
                            {
                                string subName = entryPath.Substring("dist/antigravity-stats/".Length);
                                injectedMap.TryGetValue(subName, out customBytes);
                            }

                            if (customBytes != null)
                            {
                                var integrity = ComputeIntegrity(customBytes);
                                string hash = (string)integrity["hash"];
                                entry["size"] = customBytes.Length;
                                entry["integrity"] = integrity;
                                entry.Remove("unpacked");

                                if (dedupInjected.TryGetValue(hash, out string sharedOff))
                                {
                                    entry["offset"] = sharedOff;
                                }
                                else
                                {
                                    string offStr = currentOffset.ToString(CultureInfo.InvariantCulture);
                                    entry["offset"] = offStr;
                                    dedupInjected[hash] = offStr;
                                    if (customBytes.Length > 0)
                                    {
                                        spans.Add(new WriteSpan { MemoryBytes = customBytes, Length = customBytes.Length });
                                        currentOffset += customBytes.Length;
                                    }
                                }
                            }
                            else
                            {
                                long oldOffset = long.Parse(JsonHelper.GetString(entry, "offset", "0"), CultureInfo.InvariantCulture);
                                long size = JsonHelper.GetLong(entry, "size", 0);
                                string dedupKey = $"{oldOffset}:{size}";
                                if (dedupUntouched.TryGetValue(dedupKey, out string newOff))
                                {
                                    entry["offset"] = newOff;
                                }
                                else
                                {
                                    string newOffStr = currentOffset.ToString(CultureInfo.InvariantCulture);
                                    entry["offset"] = newOffStr;
                                    dedupUntouched[dedupKey] = newOffStr;
                                    if (size > 0)
                                    {
                                        spans.Add(new WriteSpan { SourceOffset = dataBaseOffset + oldOffset, Length = size });
                                        currentOffset += size;
                                    }
                                }
                            }
                        }
                    }

                    WalkAndAssign(rootFiles, "");

                    log?.Invoke("[3/4] Writing patched app.asar and validating integrity...");
                    string newHeaderJson = JsonHelper.SerializeCompact(root);
                    using (var outFs = new FileStream(tempAsarPath, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        WritePickleHeader(outFs, newHeaderJson);
                        byte[] copyBuf = new byte[81920];

                        foreach (var span in spans)
                        {
                            if (span.MemoryBytes != null)
                            {
                                outFs.Write(span.MemoryBytes, 0, span.MemoryBytes.Length);
                            }
                            else if (span.Length > 0)
                            {
                                srcFs.Position = span.SourceOffset;
                                long remaining = span.Length;
                                while (remaining > 0)
                                {
                                    int toRead = (int)Math.Min(copyBuf.Length, remaining);
                                    int read = srcFs.Read(copyBuf, 0, toRead);
                                    if (read <= 0)
                                    {
                                        throw new EndOfStreamException("Unexpected EOF while copying data from source app.asar.");
                                    }
                                    outFs.Write(copyBuf, 0, read);
                                    remaining -= read;
                                }
                            }
                        }
                        outFs.Flush();
                    }
                }

                var tmpInfo = new FileInfo(tempAsarPath);
                if (tmpInfo.Length < minAsarSize)
                {
                    throw new InvalidDataException($"Generated app.asar size ({tmpInfo.Length} bytes) is below minimum threshold ({minAsarSize} bytes).");
                }

                VerifyAsar(tempAsarPath, contract, requirePatched: true, verifyAllHashes: false);

                if (!alreadyModified)
                {
                    bool hadBackup = File.Exists(backupPath);
                    log?.Invoke(hadBackup
                        ? "   Refreshing factory backup from validated app.asar..."
                        : "   Saving factory backup: app.asar.backup...");

                    SafeAtomicCopy(asarPath, backupPath);

                    string sourceUnpacked = asarPath + ".unpacked";
                    string backupUnpacked = backupPath + ".unpacked";
                    if (Directory.Exists(sourceUnpacked))
                    {
                        SafeReplaceDirectory(sourceUnpacked, backupUnpacked);
                    }
                    else if (Directory.Exists(backupUnpacked))
                    {
                        DeleteDirectorySafe(backupUnpacked);
                    }

                    backupCreated = !hadBackup;
                    backupRefreshed = hadBackup;
                    log?.Invoke("   ✓ Factory backup saved.");
                }

                log?.Invoke("[4/4] Applying patched app.asar atomically...");
                ReplaceFileAtomic(tempAsarPath, asarPath);

                if (!skipDevRedirect)
                {
                    RemoveStaleDevBundleRedirect(devBundleOverride, log);
                }
                CleanupLegacyShortcuts(log);

                var finalInfo = new FileInfo(asarPath);
                log?.Invoke($"   ✓ Patched app.asar applied ({finalInfo.Length / (1024.0 * 1024.0):F2} MB).");

                return new PatchResult
                {
                    Patched = true,
                    BackupCreated = backupCreated,
                    BackupRefreshed = backupRefreshed,
                    AsarPath = asarPath,
                    SizeBytes = finalInfo.Length
                };
            }
            finally
            {
                if (File.Exists(tempAsarPath))
                {
                    try { File.Delete(tempAsarPath); } catch { }
                }
            }
        }

        public static UnpatchResult Unpatch(
            string resourcesDir,
            ContractData contract,
            bool removeProxy = true,
            bool skipDevRedirect = false,
            string devBundleOverride = null,
            Action<string> log = null)
        {
            resourcesDir = EnvironmentDetector.NormalizeDirectoryPath(resourcesDir);
            string asarPath = Path.Combine(resourcesDir, "app.asar");
            string backupPath = Path.Combine(resourcesDir, "app.asar.backup");

            if (!skipDevRedirect)
            {
                RemoveStaleDevBundleRedirect(devBundleOverride, log);
            }
            CleanupLegacyShortcuts(log);

            bool asarExists = File.Exists(asarPath);
            bool isModified = asarExists && ContainsMarker(asarPath, contract.MarkerMainHook);
            bool backupExists = File.Exists(backupPath);
            bool restored = false;
            bool pristine = !isModified;

            // Never downgrade an already-unpatched official app.asar (e.g. after an official update)
            // with an older app.asar.backup.
            if (asarExists && !isModified)
            {
                log?.Invoke("[Restore] app.asar is already in pristine factory state.");
                pristine = true;
            }
            else if (!backupExists)
            {
                log?.Invoke("[Restore] Warning: app.asar appears modified, but no app.asar.backup was found.");
                pristine = false;
            }
            else
            {
                log?.Invoke("[Restore] Restoring pristine app.asar from app.asar.backup...");
                SafeAtomicCopy(backupPath, asarPath);

                string backupUnpacked = backupPath + ".unpacked";
                string targetUnpacked = asarPath + ".unpacked";
                if (Directory.Exists(backupUnpacked))
                {
                    SafeReplaceDirectory(backupUnpacked, targetUnpacked);
                }
                else if (Directory.Exists(targetUnpacked))
                {
                    DeleteDirectorySafe(targetUnpacked);
                }

                restored = true;
                pristine = true;
                log?.Invoke("   ✓ app.asar restored to factory state.");
            }

            bool proxyRemoved = false;
            if (removeProxy)
            {
                string rootDir = Path.GetDirectoryName(resourcesDir);
                if (!string.IsNullOrEmpty(rootDir) && Directory.Exists(rootDir))
                {
                    proxyRemoved = ProxyInstaller.Uninstall(rootDir, log);
                }
            }

            return new UnpatchResult
            {
                Restored = restored,
                Pristine = pristine,
                ProxyRemoved = proxyRemoved,
                Message = pristine ? "Factory state verified." : "No backup found for modified app.asar."
            };
        }

        public static void VerifyAsar(string asarPath, ContractData contract, bool requirePatched, bool verifyAllHashes)
        {
            if (!File.Exists(asarPath))
            {
                throw new FileNotFoundException($"ASAR file not found: {asarPath}");
            }

            using (var fs = new FileStream(asarPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                var (root, dataBaseOffset) = ReadArchiveHeader(fs);
                long dataAreaLen = fs.Length - dataBaseOffset;
                var rootFiles = JsonHelper.GetObject(root, "files");
                if (rootFiles == null)
                {
                    throw new InvalidDataException("Invalid ASAR header: missing root 'files'.");
                }

                var seenFiles = new HashSet<string>(StringComparer.Ordinal);

                void ValidateTree(Dictionary<string, object> dirFiles, string prefix)
                {
                    foreach (var kv in dirFiles)
                    {
                        if (kv.Key.Contains("/") || kv.Key.Contains("\\") || kv.Key == "." || kv.Key == "..")
                        {
                            throw new InvalidDataException($"Invalid entry name in ASAR: {kv.Key}");
                        }
                        string fullPath = string.IsNullOrEmpty(prefix) ? kv.Key : $"{prefix}/{kv.Key}";
                        if (!(kv.Value is Dictionary<string, object> entry))
                        {
                            throw new InvalidDataException($"Entry is not an object: {fullPath}");
                        }

                        if (entry.ContainsKey("link")) continue;
                        if (entry.TryGetValue("files", out object subObj) && subObj is Dictionary<string, object> subFiles)
                        {
                            ValidateTree(subFiles, fullPath);
                            continue;
                        }

                        seenFiles.Add(fullPath);
                        if (JsonHelper.GetBool(entry, "unpacked")) continue;

                        if (!entry.ContainsKey("offset"))
                        {
                            throw new InvalidDataException($"Missing offset for packed entry: {fullPath}");
                        }

                        long offset = long.Parse(JsonHelper.GetString(entry, "offset", "-1"), CultureInfo.InvariantCulture);
                        long size = JsonHelper.GetLong(entry, "size", -1);
                        if (offset < 0 || size < 0 || offset + size > dataAreaLen)
                        {
                            throw new InvalidDataException($"Entry out of bounds: {fullPath} (offset={offset}, size={size}, dataArea={dataAreaLen})");
                        }

                        if (verifyAllHashes && entry.TryGetValue("integrity", out object intObj) && intObj is Dictionary<string, object> integrity)
                        {
                            VerifyEntryIntegrity(fs, dataBaseOffset + offset, size, integrity, fullPath);
                        }
                    }
                }

                ValidateTree(rootFiles, "");

                if (requirePatched)
                {
                    var distNode = JsonHelper.GetObject(rootFiles, "dist");
                    var distFiles = JsonHelper.GetObject(distNode, "files");
                    if (distFiles == null) throw new InvalidDataException("Missing dist/ in patched ASAR.");

                    byte[] mainBytes = ReadFileBytesFromArchive(fs, dataBaseOffset, JsonHelper.GetObject(distFiles, "main.js"), "dist/main.js");
                    byte[] preloadBytes = ReadFileBytesFromArchive(fs, dataBaseOffset, JsonHelper.GetObject(distFiles, "preload.js"), "dist/preload.js");

                    string mainText = Utf8NoBom.GetString(mainBytes);
                    string preloadText = Utf8NoBom.GetString(preloadBytes);
                    if (!mainText.Contains(contract.MarkerMainHook))
                    {
                        throw new InvalidDataException($"Patched dist/main.js missing {contract.MarkerMainHook}.");
                    }
                    if (!preloadText.Contains(contract.MarkerPreloadBridge))
                    {
                        throw new InvalidDataException($"Patched dist/preload.js missing {contract.MarkerPreloadBridge}.");
                    }

                    foreach (string assetName in InjectedAssetNames)
                    {
                        string expectedPath = $"dist/antigravity-stats/{assetName}";
                        if (!seenFiles.Contains(expectedPath))
                        {
                            throw new InvalidDataException($"Patched ASAR missing {expectedPath}.");
                        }
                    }
                }
            }
        }

        private static void VerifyEntryIntegrity(
            FileStream fs,
            long absOffset,
            long size,
            Dictionary<string, object> integrity,
            string fullPath)
        {
            int blockSize = JsonHelper.GetInt(integrity, "blockSize", IntegrityBlockSize);
            if (blockSize <= 0) blockSize = IntegrityBlockSize;

            var blockHashes = new List<string>();
            byte[] buf = new byte[81920];
            fs.Position = absOffset;

            using (var fileSha = SHA256.Create())
            {
                var blockSha = SHA256.Create();
                try
                {
                    int currentBlockBytes = 0;
                    long remaining = size;
                    while (remaining > 0)
                    {
                        int toRead = (int)Math.Min(buf.Length, remaining);
                        int r = fs.Read(buf, 0, toRead);
                        if (r <= 0) throw new EndOfStreamException($"EOF reading {fullPath}");
                        remaining -= r;
                        fileSha.TransformBlock(buf, 0, r, null, 0);

                        int pos = 0;
                        while (pos < r)
                        {
                            int blockSpace = blockSize - currentBlockBytes;
                            int take = Math.Min(blockSpace, r - pos);
                            blockSha.TransformBlock(buf, pos, take, null, 0);
                            currentBlockBytes += take;
                            pos += take;

                            if (currentBlockBytes == blockSize)
                            {
                                blockSha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                                blockHashes.Add(EmbeddedAssets.ToLowerHex(blockSha.Hash));
                                blockSha.Dispose();
                                blockSha = SHA256.Create();
                                currentBlockBytes = 0;
                            }
                        }
                    }

                    fileSha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                    string actualHash = EmbeddedAssets.ToLowerHex(fileSha.Hash);
                    string expectedHash = JsonHelper.GetString(integrity, "hash");
                    if (!string.Equals(expectedHash, actualHash, StringComparison.Ordinal))
                    {
                        throw new InvalidDataException($"SHA256 mismatch for {fullPath}");
                    }

                    if (currentBlockBytes > 0 || blockHashes.Count == 0)
                    {
                        blockSha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                        blockHashes.Add(EmbeddedAssets.ToLowerHex(blockSha.Hash));
                    }

                    if (integrity.TryGetValue("blocks", out object blocksObj) && blocksObj is IEnumerable expectedBlocks)
                    {
                        var expectedList = new List<string>();
                        foreach (object item in expectedBlocks)
                        {
                            expectedList.Add(Convert.ToString(item, CultureInfo.InvariantCulture) ?? "");
                        }
                        if (expectedList.Count != blockHashes.Count)
                        {
                            throw new InvalidDataException($"Integrity block count mismatch for {fullPath}");
                        }
                        for (int i = 0; i < expectedList.Count; i++)
                        {
                            if (!string.Equals(expectedList[i], blockHashes[i], StringComparison.Ordinal))
                            {
                                throw new InvalidDataException($"Integrity block[{i}] SHA256 mismatch for {fullPath}");
                            }
                        }
                    }
                }
                finally
                {
                    blockSha.Dispose();
                }
            }
        }

        private static (Dictionary<string, object> Root, long DataBaseOffset) ReadArchiveHeader(FileStream fs)
        {
            if (fs.Length < 16)
            {
                throw new InvalidDataException("File is too small to be a valid ASAR archive.");
            }

            byte[] sizeBuf = new byte[8];
            fs.Position = 0;
            if (fs.Read(sizeBuf, 0, 8) != 8)
            {
                throw new InvalidDataException("Unable to read ASAR size pickle.");
            }

            uint sizePayloadSize = BitConverter.ToUInt32(sizeBuf, 0);
            if (sizePayloadSize < 4 || sizePayloadSize > 8)
            {
                throw new InvalidDataException($"Invalid ASAR size pickle payload size: {sizePayloadSize}");
            }
            uint headerBufLen = BitConverter.ToUInt32(sizeBuf, 4);
            if (headerBufLen < 8 || headerBufLen > fs.Length - 8)
            {
                throw new InvalidDataException($"Invalid ASAR header length: {headerBufLen}");
            }

            byte[] headerBuf = new byte[headerBufLen];
            int totalRead = 0;
            while (totalRead < headerBufLen)
            {
                int r = fs.Read(headerBuf, totalRead, (int)(headerBufLen - totalRead));
                if (r <= 0) throw new EndOfStreamException("Unable to read full ASAR header.");
                totalRead += r;
            }

            uint headerPayloadSize = BitConverter.ToUInt32(headerBuf, 0);
            int headerPickleHeaderSize = (int)(headerBufLen - headerPayloadSize);
            if (headerPickleHeaderSize < 4 || headerPickleHeaderSize % 4 != 0 || headerPickleHeaderSize + 4 > headerBufLen)
            {
                throw new InvalidDataException("Corrupted ASAR header pickle.");
            }

            int jsonByteLen = BitConverter.ToInt32(headerBuf, headerPickleHeaderSize);
            if (jsonByteLen < 2 || jsonByteLen > headerPayloadSize - 4)
            {
                throw new InvalidDataException($"Invalid ASAR JSON byte length: {jsonByteLen}");
            }

            string headerJson = Utf8NoBom.GetString(headerBuf, headerPickleHeaderSize + 4, jsonByteLen);
            var root = JsonHelper.DeserializeObject(headerJson);
            return (root, 8L + headerBufLen);
        }

        private static void WritePickleHeader(Stream outStream, string headerJson)
        {
            byte[] strBytes = Utf8NoBom.GetBytes(headerJson);
            int alignedStrLen = (strBytes.Length + 3) & ~3;
            uint headerPayloadSize = (uint)(4 + alignedStrLen);
            uint headerBufLen = 4 + headerPayloadSize;

            byte[] sizeBuf = new byte[8];
            Buffer.BlockCopy(BitConverter.GetBytes((uint)4), 0, sizeBuf, 0, 4);
            Buffer.BlockCopy(BitConverter.GetBytes(headerBufLen), 0, sizeBuf, 4, 4);
            outStream.Write(sizeBuf, 0, 8);

            byte[] headerBuf = new byte[headerBufLen];
            Buffer.BlockCopy(BitConverter.GetBytes(headerPayloadSize), 0, headerBuf, 0, 4);
            Buffer.BlockCopy(BitConverter.GetBytes(strBytes.Length), 0, headerBuf, 4, 4);
            Buffer.BlockCopy(strBytes, 0, headerBuf, 8, strBytes.Length);
            outStream.Write(headerBuf, 0, headerBuf.Length);
        }

        private static byte[] ReadFileBytesFromArchive(FileStream fs, long dataBaseOffset, Dictionary<string, object> entry, string entryName)
        {
            if (entry == null) throw new InvalidDataException($"Missing entry in ASAR: {entryName}");
            if (JsonHelper.GetBool(entry, "unpacked"))
            {
                throw new InvalidDataException($"Expected packed entry for {entryName}, found unpacked.");
            }
            long offset = long.Parse(JsonHelper.GetString(entry, "offset", "-1"), CultureInfo.InvariantCulture);
            int size = JsonHelper.GetInt(entry, "size", -1);
            if (offset < 0 || size < 0 || dataBaseOffset + offset + size > fs.Length)
            {
                throw new InvalidDataException($"Invalid offset/size for {entryName}");
            }

            byte[] bytes = new byte[size];
            fs.Position = dataBaseOffset + offset;
            int total = 0;
            while (total < size)
            {
                int r = fs.Read(bytes, total, size - total);
                if (r <= 0) throw new EndOfStreamException($"Unexpected EOF reading {entryName}");
                total += r;
            }
            return bytes;
        }

        private static Dictionary<string, object> ComputeIntegrity(byte[] data)
        {
            string fullHash = EmbeddedAssets.ComputeSha256Hex(data);
            var blocks = new List<object>();

            if (data.Length == 0)
            {
                blocks.Add(fullHash);
            }
            else
            {
                using (var sha = SHA256.Create())
                {
                    for (int offset = 0; offset < data.Length; offset += IntegrityBlockSize)
                    {
                        int count = Math.Min(IntegrityBlockSize, data.Length - offset);
                        byte[] chunkHash = sha.ComputeHash(data, offset, count);
                        blocks.Add(EmbeddedAssets.ToLowerHex(chunkHash));
                    }
                }
            }

            return new Dictionary<string, object>(StringComparer.Ordinal)
            {
                ["algorithm"] = "SHA256",
                ["hash"] = fullHash,
                ["blockSize"] = IntegrityBlockSize,
                ["blocks"] = blocks
            };
        }

        private static string InjectMainHook(string mainContent, ContractData contract)
        {
            if (mainContent.Contains(contract.MarkerMainHook))
            {
                return mainContent;
            }

            string hook = $"\n// {contract.MarkerMainHook}\ntry {{ require('./antigravity-stats/loader.cjs'); }} catch (e) {{ console.error('[TokenStats Loader Error]:', e); }}\n";
            var match = Regex.Match(mainContent, @"^(\uFEFF?\s*['""]use strict['""];?\r?\n?)");
            if (match.Success)
            {
                return match.Value + hook + mainContent.Substring(match.Length);
            }
            if (mainContent.StartsWith("\uFEFF", StringComparison.Ordinal))
            {
                return "\uFEFF" + hook + mainContent.Substring(1);
            }
            return hook + mainContent;
        }

        private static string InjectPreloadHook(string preloadContent, ContractData contract)
        {
            if (preloadContent.Contains(contract.MarkerPreloadBridge))
            {
                return preloadContent;
            }

            string hook = $@"
// {contract.MarkerPreloadBridge}
try {{
  const _electron = require('electron');
  const _cb = _electron.contextBridge || (typeof electron_1 !== 'undefined' ? electron_1.contextBridge : null);
  const _ipc = _electron.ipcRenderer || (typeof electron_1 !== 'undefined' ? electron_1.ipcRenderer : null);
  if (_cb && _ipc) {{
    _cb.exposeInMainWorld('{contract.WindowSyncBridge}', {{
      requestSync: (payload) => _ipc.invoke('{contract.IpcRequestSync}', payload),
    }});
  }}
}} catch (e) {{
  try {{
    electron_1.contextBridge.exposeInMainWorld('{contract.WindowSyncBridge}', {{
      requestSync: (payload) => electron_1.ipcRenderer.invoke('{contract.IpcRequestSync}', payload),
    }});
  }} catch (err) {{}}
}}
";
            return preloadContent + hook;
        }

        private static void SafeAtomicCopy(string sourceFile, string targetFile)
        {
            string tempTarget = $"{targetFile}.tmp.{DateTime.UtcNow.Ticks}";
            try
            {
                File.Copy(sourceFile, tempTarget, overwrite: true);
                ReplaceFileAtomic(tempTarget, targetFile);
            }
            finally
            {
                if (File.Exists(tempTarget))
                {
                    try { File.Delete(tempTarget); } catch { }
                }
            }
        }

        private static void ReplaceFileAtomic(string tempFile, string targetFile)
        {
            if (File.Exists(targetFile))
            {
                var attrs = File.GetAttributes(targetFile);
                if ((attrs & FileAttributes.ReadOnly) != 0)
                {
                    File.SetAttributes(targetFile, attrs & ~FileAttributes.ReadOnly);
                }
                File.Replace(tempFile, targetFile, null, ignoreMetadataErrors: true);
            }
            else
            {
                File.Move(tempFile, targetFile);
            }
        }

        private static string ToLongPath(string path)
        {
            if (string.IsNullOrEmpty(path) || path.StartsWith(@"\\?\", StringComparison.Ordinal)) return path;
            if (path.StartsWith(@"\\", StringComparison.Ordinal)) return @"\\?\UNC\" + path.Substring(2);
            return @"\\?\" + path;
        }

        private static void SafeReplaceDirectory(string sourceDir, string targetDir)
        {
            string tag = (DateTime.UtcNow.Ticks & 0xFFFF).ToString("x", CultureInfo.InvariantCulture);
            string tempTarget = ToLongPath($"{targetDir}.t{tag}");
            string oldTarget = ToLongPath($"{targetDir}.o{tag}");
            string longTarget = ToLongPath(targetDir);
            bool targetMoved = false;
            bool targetInstalled = false;

            try
            {
                CopyDirectoryRecursive(sourceDir, tempTarget);
                if (Directory.Exists(longTarget))
                {
                    Directory.Move(longTarget, oldTarget);
                    targetMoved = true;
                }
                Directory.Move(tempTarget, longTarget);
                targetInstalled = true;
            }
            catch
            {
                try
                {
                    if (targetInstalled && Directory.Exists(longTarget)) DeleteDirectorySafe(longTarget);
                    if (targetMoved && Directory.Exists(oldTarget)) Directory.Move(oldTarget, longTarget);
                }
                catch { }
                throw;
            }
            finally
            {
                if (targetInstalled && Directory.Exists(oldTarget)) DeleteDirectorySafe(oldTarget);
                if (Directory.Exists(tempTarget)) DeleteDirectorySafe(tempTarget);
            }
        }

        private static void CopyDirectoryRecursive(string sourceDir, string targetDir)
        {
            string srcLong = ToLongPath(sourceDir);
            string dstLong = ToLongPath(targetDir);
            Directory.CreateDirectory(dstLong);
            foreach (string file in Directory.GetFiles(srcLong))
            {
                File.Copy(file, Path.Combine(dstLong, Path.GetFileName(file)), overwrite: true);
            }
            foreach (string subDir in Directory.GetDirectories(srcLong))
            {
                CopyDirectoryRecursive(subDir, Path.Combine(dstLong, Path.GetFileName(subDir)));
            }
        }

        private static void DeleteDirectorySafe(string dir)
        {
            try
            {
                string longDir = ToLongPath(dir);
                if (Directory.Exists(longDir)) Directory.Delete(longDir, recursive: true);
            }
            catch { }
        }

        private static void RemoveStaleDevBundleRedirect(string devBundleOverride, Action<string> log)
        {
            try
            {
                string devBundleFile = devBundleOverride;
                if (string.IsNullOrEmpty(devBundleFile))
                {
                    string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    devBundleFile = Path.Combine(localAppData, "AntiToken", "dev-bundle.path");
                }
                if (File.Exists(devBundleFile))
                {
                    File.Delete(devBundleFile);
                    log?.Invoke("   ✓ Removed stale dev-bundle redirect.");
                }
            }
            catch { }
        }

        private static void CleanupLegacyShortcuts(Action<string> log)
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Microsoft", "Windows", "Start Menu", "Programs");
                string[] shortcuts =
                {
                    Path.Combine(desktop, "Antigravity (with Stats).lnk"),
                    Path.Combine(startMenu, "Antigravity (with Stats).lnk")
                };
                foreach (string sc in shortcuts)
                {
                    if (File.Exists(sc))
                    {
                        File.Delete(sc);
                        log?.Invoke($"   ✓ Removed legacy shortcut: {Path.GetFileName(sc)}");
                    }
                }
            }
            catch { }
        }
    }
}
