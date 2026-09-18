const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const workerCode = `
  const started = performance.now();
  const { computeStats } = require('./scripts/aggregate-stats.cjs');
  const stats = computeStats(true);
  console.log(JSON.stringify({
    elapsed: performance.now() - started,
    scannedFiles: stats.meta.scannedConversations,
    rss: process.memoryUsage().rss,
  }));
`;

function runWorker(dataRoot, cachePath, extraEnv = {}) {
  const env = { ...process.env, ANTIGRAVITY_DATA_DIR: dataRoot, ANTIGRAVITY_STATS_CACHE_PATH: cachePath, ...extraEnv };
  const result = spawnSync(process.execPath, ['-e', workerCode], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(name, samples, changedFiles, cachePath) {
  const times = samples.map(sample => sample.elapsed);
  const latest = samples.at(-1);
  const cacheSize = fs.existsSync(cachePath) ? fs.statSync(cachePath).size : 0;
  console.log(`[${name}]`);
  console.log(`  - p50: ${percentile(times, 0.5).toFixed(2)} ms | p95: ${percentile(times, 0.95).toFixed(2)} ms`);
  console.log(`  - Scanned files: ${latest.scannedFiles} | Changed files: ${changedFiles} | Cache: ${(cacheSize / 1024).toFixed(1)} KB`);
  console.log(`  - RSS: ${(latest.rss / 1024 / 1024).toFixed(2)} MB\n`);
}

function invalidateOneCacheEntry(cachePath) {
  const snapshot = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const entry = Object.values(snapshot.transcripts || {})[0] || Object.values(snapshot.dbs || {})[0];
  if (!entry) return 0;
  if (entry.fingerprint.db) entry.fingerprint.db.size += 1;
  else entry.fingerprint.size += 1;
  fs.writeFileSync(cachePath, JSON.stringify(snapshot), 'utf8');
  return 1;
}

function main() {
  const dataRoot = process.env.ANTIGRAVITY_BENCHMARK_DATA_DIR || process.env.ANTIGRAVITY_DATA_DIR || path.join(os.homedir(), '.gemini', 'antigravity');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-'));
  const cachePath = path.join(tempDir, 'stats-cache.json');

  try {
    console.log('===============================================================');
    console.log('   ANTIGRAVITY 2.0 TOKEN STATS - PERSISTENT CACHE BENCHMARK   ');
    console.log('===============================================================\n');

    const bundlePath = path.join(__dirname, '..', 'dist-bundle', 'antigravity-stats-bundle.js');
    const bundleSize = fs.existsSync(bundlePath) ? fs.statSync(bundlePath).size : 0;
    console.log(`[Static] Bundle: ${(bundleSize / 1024).toFixed(1)} KB | Data root: ${dataRoot}\n`);

    const fullScan = [];
    for (let i = 0; i < 3; i++) {
      fullScan.push(runWorker(dataRoot, cachePath, { ANTIGRAVITY_DISABLE_PERSIST_CACHE: '1' }));
    }
    summarize('1. Full scan (persistent cache disabled)', fullScan, 0, cachePath);

    runWorker(dataRoot, cachePath);
    const validCache = [];
    for (let i = 0; i < 5; i++) validCache.push(runWorker(dataRoot, cachePath));
    summarize('2. Valid cache after process restart', validCache, 0, cachePath);

    const changedFiles = invalidateOneCacheEntry(cachePath);
    const changedSession = [runWorker(dataRoot, cachePath)];
    summarize('3. One cache entry invalidated', changedSession, changedFiles, cachePath);

    fs.writeFileSync(cachePath, '{', 'utf8');
    const corruptCache = [runWorker(dataRoot, cachePath)];
    summarize('4. Corrupt cache fallback', corruptCache, 0, cachePath);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

main();
