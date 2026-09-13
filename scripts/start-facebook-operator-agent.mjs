import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { installWindowsAgentAutostart } from '../src/windows-agent-autostart.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const runtimeScript = path.join(__dirname, 'facebook-operator-agent-runtime.mjs');
const restartHelperScript = path.join(__dirname, 'restart-facebook-operator-agent.mjs');
const logPath = path.join(root, 'data', 'operator-agent-update.log');
const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const autoUpdateEnabled = String(process.env.FB_AGENT_AUTO_UPDATE ?? 'true').toLowerCase() !== 'false';
const autoStartEnabled = String(process.env.FB_AGENT_AUTOSTART ?? 'true').toLowerCase() !== 'false';
const updateCheckMs = Math.max(30_000, Number(process.env.FB_AGENT_AUTO_UPDATE_MS || 60_000));
const expectedRepository = String(process.env.FB_AGENT_UPDATE_REPOSITORY || 'hiep4294/Social-Manager').trim().toLowerCase();
const updateBranchRaw = String(process.env.FB_AGENT_UPDATE_BRANCH || 'stable').trim();
const updateBranch = /^[A-Za-z0-9._/-]+$/.test(updateBranchRaw) ? updateBranchRaw : 'stable';
const updateRemoteRef = `origin/${updateBranch}`;
const watchdogManaged = String(process.env.FB_AGENT_WATCHDOG_CHILD || '').toLowerCase() === 'true';

fs.mkdirSync(path.dirname(logPath), { recursive: true });

let child = null;
let updating = false;
let shuttingDown = false;
let restartTimer = null;
let lastSkipReason = '';
let instanceServer = null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(`Agent supervisor: ${message}`);
  try { fs.appendFileSync(logPath, `${line}\n`, 'utf8'); } catch {}
}

async function acquireSingleInstance() {
  if (process.platform !== 'win32') return true;
  const pipeName = '\\\\.\\pipe\\SocialManagerFacebookOperatorAgent-hiep4294';
  const server = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipeName, () => {
      server.removeListener('error', reject);
      resolve();
    });
  }).catch(error => {
    if (String(error?.code || '') === 'EADDRINUSE') {
      console.log('Agent supervisor: một Agent khác đang chạy; phiên này dừng để tránh xử lý trùng lệnh.');
      process.exit(0);
    }
    throw error;
  });
  instanceServer = server;
  return true;
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    windowsHide: true
  });
  if (result.error && !allowFailure) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} lỗi: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null
  };
}

function git(args, options) {
  return run('git', args, options);
}

function remoteIsTrusted() {
  const result = git(['config', '--get', 'remote.origin.url'], { allowFailure: true });
  const raw = result.stdout.trim();
  if (!raw) return { ok: false, url: '' };
  const normalized = raw
    .replace(/\\/g, '/')
    .replace(/\.git$/i, '')
    .replace(/^ssh:\/\/git@github\.com\//i, 'github.com/')
    .replace(/^git@github\.com:/i, 'github.com/')
    .replace(/^https?:\/\/github\.com\//i, 'github.com/')
    .toLowerCase();
  return { ok: normalized === `github.com/${expectedRepository}`, url: raw };
}

function trackedWorktreeIsClean() {
  return !git(['status', '--porcelain', '--untracked-files=no']).stdout;
}

function processingJobs() {
  if (!fs.existsSync(dbPath)) return 0;
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT COUNT(*) AS n FROM facebook_operator_jobs WHERE status='PROCESSING'").get();
    db.close();
    return Number(row?.n || 0);
  } catch {
    return 0;
  }
}

function changedFiles(oldHead, newHead) {
  return git(['diff', '--name-only', oldHead, newHead]).stdout
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);
}

function agentRuntimeChanged(files) {
  return files.some(file =>
    file.startsWith('src/') ||
    file.startsWith('scripts/') ||
    file === 'package.json' ||
    file === 'package-lock.json' ||
    file === 'npm-shrinkwrap.json'
  );
}

function supervisorChanged(files) {
  return files.some(file => [
    'scripts/start-facebook-operator-agent.mjs',
    'scripts/restart-facebook-operator-agent.mjs',
    'scripts/facebook-operator-agent-watchdog.mjs',
    'src/windows-agent-autostart.js'
  ].includes(file));
}

function dependenciesChanged(files) {
  return files.some(file =>
    file === 'package.json' ||
    file === 'package-lock.json' ||
    file === 'npm-shrinkwrap.json'
  );
}

function installDependencies() {
  const hasLock = fs.existsSync(path.join(root, 'package-lock.json'));
  const args = hasLock
    ? ['ci', '--no-audit', '--no-fund']
    : ['install', '--no-audit', '--no-fund'];
  run(npmCommand, args);
}

function scheduleChildRestart() {
  if (restartTimer || shuttingDown) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (!child && !updating && !shuttingDown) startChild();
  }, 5_000);
}

function startChild() {
  if (child || shuttingDown) return;
  const proc = spawn(process.execPath, [runtimeScript], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false
  });
  child = proc;
  log(`runtime started pid=${proc.pid}`);
  proc.on('exit', (code, signal) => {
    if (child === proc) child = null;
    if (shuttingDown) return;
    log(`runtime stopped code=${code ?? 'null'} signal=${signal || 'none'}`);
    scheduleChildRestart();
  });
}

async function stopChild() {
  const proc = child;
  if (!proc) return;
  await new Promise(resolve => {
    let finished = false;
    let timer = null;
    const done = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    proc.once('exit', done);
    try { proc.kill('SIGTERM'); } catch { done(); return; }
    timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      setTimeout(done, 500);
    }, 10_000);
  });
  if (child === proc) child = null;
}

function logSkipOnce(reason) {
  if (reason === lastSkipReason) return;
  lastSkipReason = reason;
  log(reason);
}

function spawnSupervisorRestartHelper() {
  const restartLog = path.join(root, 'data', 'operator-agent-restart.log');
  const fd = fs.openSync(restartLog, 'a');
  const helper = spawn(process.execPath, [restartHelperScript, String(process.pid)], {
    cwd: root,
    env: process.env,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true
  });
  helper.unref();
  try { fs.closeSync(fd); } catch {}
}

async function checkForUpdate({ startup = false } = {}) {
  if (!autoUpdateEnabled || updating || shuttingDown) return false;
  updating = true;
  let childWasStopped = false;
  let oldHead = null;
  let dependencyUpdate = false;
  let fullSupervisorRestart = false;

  try {
    const trusted = remoteIsTrusted();
    if (!trusted.ok) {
      logSkipOnce(`auto update bị chặn: remote origin không phải repository tin cậy (${trusted.url || 'không xác định'})`);
      return false;
    }

    const fetchResult = git(['fetch', '--quiet', 'origin', updateBranch], { allowFailure: true });
    if (fetchResult.status !== 0) {
      logSkipOnce(`chưa kiểm tra được kênh ${updateBranch}: ${fetchResult.stderr || fetchResult.stdout || 'git fetch lỗi'}`);
      return false;
    }

    oldHead = git(['rev-parse', 'HEAD']).stdout;
    const remoteHead = git(['rev-parse', updateRemoteRef]).stdout;
    if (!oldHead || !remoteHead || oldHead === remoteHead) {
      lastSkipReason = '';
      return false;
    }

    if (!trackedWorktreeIsClean()) {
      logSkipOnce('phát hiện file source đã sửa cục bộ; tạm hoãn auto update để không ghi đè thay đổi');
      return false;
    }

    const ff = git(['merge-base', '--is-ancestor', oldHead, remoteHead], { allowFailure: true });
    if (ff.status !== 0) {
      logSkipOnce(`nhánh local không thể fast-forward tới ${updateRemoteRef}; tạm hoãn auto update`);
      return false;
    }

    const files = changedFiles(oldHead, remoteHead);
    if (!agentRuntimeChanged(files)) {
      git(['merge', '--ff-only', updateRemoteRef]);
      lastSkipReason = '';
      return false;
    }

    const active = processingJobs();
    if (active > 0) {
      logSkipOnce(`đang có ${active} tác vụ Facebook PROCESSING; hoãn cập nhật đến lượt kiểm tra tiếp theo`);
      return false;
    }

    lastSkipReason = '';
    dependencyUpdate = dependenciesChanged(files);
    fullSupervisorRestart = supervisorChanged(files);
    log(`phát hiện bản Agent mới từ kênh ${updateBranch}: ${oldHead.slice(0, 7)} -> ${remoteHead.slice(0, 7)}${startup ? ' khi khởi động' : ''}`);

    if (child) {
      await stopChild();
      childWasStopped = true;
    }

    git(['merge', '--ff-only', updateRemoteRef]);
    if (dependencyUpdate) {
      log('dependency thay đổi; đang cài lại package');
      installDependencies();
    }

    log('đang tự kiểm thử bản cập nhật bằng npm test');
    run(npmCommand, ['test']);
    log(`cập nhật thành công lên ${remoteHead.slice(0, 7)} từ kênh ${updateBranch}`);

    if (fullSupervisorRestart) {
      shuttingDown = true;
      if (watchdogManaged) {
        log('thành phần Supervisor thay đổi; Watchdog sẽ tự khởi động lại Supervisor.');
      } else {
        log('thành phần Supervisor thay đổi; thực hiện full restart để nạp code mới');
        spawnSupervisorRestartHelper();
      }
      setTimeout(() => process.exit(0), 350);
    } else {
      log('tự khởi động lại Agent runtime');
    }
    return true;
  } catch (error) {
    const message = String(error?.message || error);
    log(`cập nhật lỗi: ${message}`);

    if (oldHead) {
      try {
        git(['reset', '--hard', oldHead]);
        if (dependencyUpdate) installDependencies();
        log(`đã rollback về ${oldHead.slice(0, 7)}`);
      } catch (rollbackError) {
        log(`rollback lỗi: ${String(rollbackError?.message || rollbackError)}`);
      }
    }
    return false;
  } finally {
    updating = false;
    if (!child && !shuttingDown && (childWasStopped || startup)) startChild();
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  log(`shutdown ${signal}`);
  await stopChild().catch(() => {});
  try { instanceServer?.close(); } catch {}
  process.exit(0);
}

process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(0)); });
process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(0)); });

await acquireSingleInstance();

console.log('Social Manager Facebook Operator Agent Supervisor');
console.log(`Auto update: ${autoUpdateEnabled ? 'ON' : 'OFF'} | channel=${updateBranch} | mỗi ${Math.round(updateCheckMs / 1000)} giây`);
console.log(`Windows auto-start: ${process.platform === 'win32' && autoStartEnabled ? 'ON' : 'OFF'}`);
console.log(`Watchdog managed: ${watchdogManaged ? 'YES' : 'NO'}`);
console.log('Update policy: trusted repo + stable channel + clean source + không cắt ngang job + fast-forward only + npm test + rollback nếu lỗi.');

if (process.platform === 'win32' && autoStartEnabled) {
  try {
    const result = installWindowsAgentAutostart({ root, nodePath: process.execPath });
    log(`Windows auto-start đã sẵn sàng mode=${result.mode}; log nền: ${result.log_path}`);
    if (result.task_error) log(`Task Scheduler fallback: ${result.task_error}`);
  } catch (error) {
    log(`không cài được Windows auto-start: ${String(error?.message || error)}`);
  }
}

await checkForUpdate({ startup: true });
if (!child && !shuttingDown) startChild();

setInterval(() => {
  checkForUpdate().catch(error => log(`update loop lỗi: ${String(error?.message || error)}`));
}, updateCheckMs);
