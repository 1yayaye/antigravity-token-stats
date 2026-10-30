/**
 * Live-quota probe for the Antigravity IDE extension host service.
 *
 * Bundles hosts/antigravity-ide/extension/src/quota-service.ts with esbuild into
 * a temp file and drives fetchLiveQuota(true) from plain Node — the same code the
 * extension runs, without re-implementing the token/protobuf parsing here.
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

const serviceEntry = path.join(__dirname, '..', 'extension', 'src', 'quota-service.ts');

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
    if (!quota || !quota.weeklyGemini) {
      console.error('[probe-quota] No live quota available (no IDE login token or endpoint refused the request).');
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ capturedAt: quota.capturedAt, weeklyGemini: quota.weeklyGemini }, null, 2));
  } catch (err) {
    console.error('[probe-quota] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    try { fs.rmSync(outfile, { force: true }); } catch {}
  }
}

main();
