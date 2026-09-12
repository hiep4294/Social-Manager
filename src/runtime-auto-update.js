import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const enabled = String(process.env.AUTO_UPDATE_ENABLED || '').toLowerCase() === 'true';

function fileHash(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function readLocalVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} lỗi: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return String(result.stdout || '').trim();
}

export function shouldAutoUpdate(localVersion, remoteVersion) {
  const local = String(localVersion || '').trim();
  const remote = String(remoteVersion || '').trim();
  return Boolean(local && remote && local !== remote);
}

if (enabled) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');
  const manifestUrl = String(
    process.env.AUTO_UPDATE_MANIFEST_URL ||
    'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/runtime-version.json'
  );
  const checkMs = Math.max(30_000, Number(process.env.AUTO_UPDATE_CHECK_MS || 60_000));
  const logPath = path.join(root, 'data', 'auto-update.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  let updating = false;

  function log(message) {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(`Auto update: ${message}`);
    try { fs.appendFileSync(logPath, `${line}\n`, 'utf8'); } catch {}
  }

  async function check() {
    if (updating) return;
    try {
      const url = new URL(manifestUrl);
      url.searchParams.set('_', String(Date.now()));
      const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      const manifest = await response.json();
      const remoteVersion = String(manifest?.version || '').trim();
      const localVersion = readLocalVersion(root);
      if (!shouldAutoUpdate(localVersion, remoteVersion)) return;

      updating = true;
      log(`phát hiện bản ${remoteVersion}, hiện tại ${localVersion}; bắt đầu cập nhật`);

      const packagePath = path.join(root, 'package.json');
      const lockPath = path.join(root, 'package-lock.json');
      const oldPackageHash = fileHash(packagePath);
      const oldLockHash = fileHash(lockPath);

      run('git', ['fetch', 'origin', 'main'], root);
      run('git', ['reset', '--hard', 'origin/main'], root);

      const newPackageHash = fileHash(packagePath);
      const newLockHash = fileHash(lockPath);
      if (oldPackageHash !== newPackageHash || oldLockHash !== newLockHash) {
        log('dependency manifest thay đổi; chạy npm install');
        run('npm', ['install'], root);
      }

      const installedVersion = readLocalVersion(root);
      log(`đã cập nhật source lên ${installedVersion}; khởi động lại dịch vụ`);

      const runtimeLog = path.join(root, 'data', 'codespace-runtime.log');
      const fd = fs.openSync(runtimeLog, 'a');
      const childCode = "setTimeout(()=>import('./scripts/start-codespace.mjs').catch(e=>{console.error(e);process.exit(1)}),1800)";
      const child = spawn(process.execPath, ['-e', childCode], {
        cwd: root,
        env: process.env,
        detached: true,
        stdio: ['ignore', fd, fd]
      });
      child.unref();
      try { fs.closeSync(fd); } catch {}

      setTimeout(() => process.exit(0), 250);
    } catch (error) {
      updating = false;
      log(`kiểm tra/cập nhật lỗi: ${String(error?.message || error)}`);
    }
  }

  setInterval(() => check().catch(() => {}), checkMs);
  setTimeout(() => check().catch(() => {}), 10_000);
  log(`enabled, kiểm tra mỗi ${Math.round(checkMs / 1000)}s`);
}
