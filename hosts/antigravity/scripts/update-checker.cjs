const RELEASE_ROOT = 'https://github.com/1yayaye/antigravity-token-stats/releases/download';
const RELEASE_API = 'https://api.github.com/repos/1yayaye/antigravity-token-stats/releases/latest';
let started = false;

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.').map(Number);
  return parts.length === 3 && parts.every(n => Number.isSafeInteger(n) && n >= 0) && parts.join('.') === value
    ? parts : null;
}

// Called after the first desktop UI load; owns one schedule for the whole process.
function startUpdateChecks({ app, net, dialog, shell }, currentVersion) {
  if (started) return;
  const current = parseVersion(currentVersion);
  if (!current) throw new Error('Invalid AntiToken package version');
  started = true;

  const promptedVersions = new Set();
  const lifetime = new AbortController();
  let stopped = false;
  let busy = false;
  let request = null;

  async function check() {
    if (stopped || busy) return;
    busy = true;
    request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 15_000);
    try {
      const response = await net.fetch(RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `AntiToken/${currentVersion}` },
        credentials: 'omit',
        redirect: 'error',
        signal: request.signal,
      });
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const release = await response.json();
      if (stopped) return;
      if (request.signal.aborted) throw new Error('Update check timed out');
      clearTimeout(timeout);
      if (release?.draft === true || release?.prerelease === true) return;
      if (release?.draft !== false || release?.prerelease !== false ||
          typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
        throw new Error('Invalid release metadata');
      }
      const version = release.tag_name.replace(/^v/, '');
      const next = parseVersion(version);
      if (!next) throw new Error('Invalid release version');
      const difference = next[0] - current[0] || next[1] - current[1] || next[2] - current[2];
      if (difference <= 0 || promptedVersions.has(version)) return;

      const name = `antigravity-token-stats-v${version}-setup.exe`;
      const downloadUrl = `${RELEASE_ROOT}/${release.tag_name}/${name}`;
      const asset = release.assets.find(item => item?.name === name);
      if (asset?.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
          asset.browser_download_url !== downloadUrl) {
        throw new Error('Release installer is unavailable or invalid');
      }

      const chinese = app.getPreferredSystemLanguages()[0]?.toLowerCase().startsWith('zh');
      const { response: choice } = await dialog.showMessageBox({
        type: 'info',
        title: 'AntiToken',
        message: chinese ? `发现新版本 v${version}` : `New version available: v${version}`,
        detail: chinese
          ? `当前版本：v${currentVersion}\n下载安装器后，运行并点击“安装 / 更新补丁”。`
          : `Current version: v${currentVersion}\nDownload and run the installer, then click "Install / Update Patch".`,
        buttons: chinese ? ['下载更新', '稍后'] : ['Download update', 'Later'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        signal: lifetime.signal,
      });
      promptedVersions.add(version);
      if (!stopped && choice === 0) await shell.openExternal(downloadUrl);
    } catch (error) {
      if (!stopped) console.warn('[TokenStats Update]', error.message);
    } finally {
      clearTimeout(timeout);
      request = null;
      busy = false;
    }
  }

  const initialTimer = setTimeout(check, 10_000);
  const interval = setInterval(check, 6 * 60 * 60 * 1000);
  app.once('will-quit', () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(interval);
    request?.abort();
    lifetime.abort();
  });
}

module.exports = { startUpdateChecks };
