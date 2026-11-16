/**
 * Standalone live-quota probe for the Antigravity IDE service.
 *
 * Bundles hosts/antigravity-ide/src/quota-service.ts into a temp file and drives
 * fetchLiveQuota(true) from plain Node. The installed host uses Electron net.fetch;
 * this diagnostic uses Node fetch and does not verify the IDE's proxy path.
 *
 * Prints the weeklyGemini part of the parsed quota plus capturedAt to stdout.
 * Exit code 0 = quota data retrieved; non-zero = failure (no IDE token, or the
 * cloud endpoint rejected the request). Token values are never printed.
 *
 * Usage: node hosts/antigravity-ide/scripts/probe-quota.cjs
 */
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const serviceEntry = path.join(__dirname, '..', 'src', 'quota-service.ts');

async function main() {
  const outfile = path.join(os.tmpdir(), `antigravity-ide-quota-service-${process.pid}.cjs`);
  try {
    esbuild.buildSync({
      entryPoints: [serviceEntry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      outfile,
      logLevel: 'silent',
    });
    const { fetchLiveQuota } = require(outfile);
    const quota = await fetchLiveQuota(true);
    if (!quota || (!quota.weeklyGemini && !quota.weeklyClaude && !quota.weeklyArgon)) {
      console.error('[probe-quota] No live quota available (no IDE login token or endpoint refused the request).');
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({
      capturedAt: quota.capturedAt,
      detectedAccountTier: quota.detectedAccountTier ?? null,
      weeklyGemini: quota.weeklyGemini,
      weeklyClaude: quota.weeklyClaude,
      weeklyArgon: quota.weeklyArgon,
    }, null, 2));
  } catch (err) {
    console.error('[probe-quota] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    try { fs.rmSync(outfile, { force: true }); } catch {}
  }
}

main();
