import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { installWindowsAgentAutostart } from '../src/windows-agent-autostart.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const runtimeFile = path.join(__dirname, 'facebook-operator-agent-runtime.mjs');
const dbFile = process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db');
const branch = String(process.env.FB_AGENT_UPDATE_BRANCH || 'stable');
const intervalMs = Math.max(30000, Number(process.env.FB_AGENT_AUTO_UPDATE_MS || 60000));
const watchdogManaged = String(process.env.FB_AGENT_WATCHDOG_CHILD || '').toLowerCase() === 'true';
const publicDir = path.join(root, 'public');
const supervisorStatusPath = path.join(publicDir, 'supervisor-health.json');
fs.mkdirSync(publicDir, { recursive: true });

let runtime = null;
let runtimeStartedAt = 0;
let crashTimes = [];
let busy = false;
let stopping = false;

function nowIso() { return new Date().toISOString(); }
function log(text) { console.log(`Agent supervisor: ${text}`); }
function writeSupervisorStatus(extra = {}) {
  try {
    fs.writeFileSync(supervisorStatusPath, JSON.stringify({
      online: true,
      update_branch: branch,
      watchdog_managed: watchdogManaged,
      runtime_pid: runtime?.pid || null,
      crash_count_10m: crashTimes.length,
      ...extra,
      updated_at: nowIso()
    }, null, 2), 'utf8');
  } catch {}
}

function run(command, args, allowFailure = false) {
  const r = spawnSync(command, args, { cwd: root, env: process.env, encoding: 'utf8', windowsHide: true });
  if (!allowFailure && (r.error || r.status !== 0)) throw r.error || new Error((r.stderr || r.stdout || 'command failed').trim());
  return { status: r.status ?? 1, stdout: String(r.stdout || '').trim(), stderr: String(r.stderr || '').trim() };
}

const git = (args, allowFailure = false) => run('git', args, allowFailure);

function npm(args) {
  const cli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].find(x => x && fs.existsSync(x));
  if (!cli) throw new Error('Không tìm thấy npm-cli.js');
  return run(process.execPath, [cli, ...args]);
}

async function lockSingleInstance() {
  if (process.platform !== 'win32') return;
  const server = net.createServer(s => s.end());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen('\\\\.\\pipe\\SocialManagerFacebookOperatorAgent-hiep4294', resolve);
  }).catch(error => {
    if (error?.code === 'EADDRINUSE') process.exit(0);
    throw error;
  });
}

function processingCount() {
  if (!fs.existsSync(dbFile)) return 0;
  try {
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    const n = Number(db.prepare("SELECT COUNT(*) AS n FROM facebook_operator_jobs WHERE status='PROCESSING'").get()?.n || 0);
    db.close();
    return n;
  } catch { return 0; }
}

function runtimeRestartDelay(lifetimeMs) {
  const now = Date.now();
  if (lifetimeMs >= 10 * 60 * 1000) crashTimes = [];
  crashTimes = crashTimes.filter(t => now - t < 10 * 60 * 1000);
  crashTimes.push(now);
  const delays = [5000, 10000, 20000, 40000, 120000, 300000];
  return delays[Math.min(crashTimes.length - 1, delays.length - 1)];
}

function startRuntime() {
  if (runtime || stopping) return;
  runtimeStartedAt = Date.now();
  runtime = spawn(process.execPath, [runtimeFile], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: false });
  log(`runtime started pid=${runtime.pid}`);
  writeSupervisorStatus({ status: 'RUNTIME_STARTED' });
  const child = runtime;
  child.once('exit', (code, signal) => {
    const lifetime = Date.now() - runtimeStartedAt;
    if (runtime === child) runtime = null;
    if (stopping || busy) return;
    const delay = runtimeRestartDelay(lifetime);
    log(`runtime stopped code=${code ?? 'null'} signal=${signal || 'none'}; restart in ${Math.round(delay / 1000)}s`);
    writeSupervisorStatus({ status: 'RUNTIME_RESTART_WAIT', last_exit: { code, signal, lifetime_ms: lifetime }, restart_delay_ms: delay });
    setTimeout(startRuntime, delay);
  });
}

async function stopRuntime() {
  if (!runtime) return;
  const child = runtime;
  await new Promise(resolve => {
    child.once('exit', resolve);
    try { child.kill('SIGTERM'); } catch { resolve(); }
    setTimeout(resolve, 10000);
  });
  if (runtime === child) runtime = null;
}

function dependenciesChanged(oldHead, newHead) {
  const names = git(['diff', '--name-only', oldHead, newHead]).stdout.split(/\r?\n/).filter(Boolean);
  if (names.includes('package-lock.json') || names.includes('npm-shrinkwrap.json')) return true;
  if (!names.includes('package.json')) return false;
  try {
    const before = JSON.parse(git(['show', `${oldHead}:package.json`]).stdout);
    const after = JSON.parse(git(['show', `${newHead}:package.json`]).stdout);
    return ['dependencies','devDependencies','optionalDependencies','peerDependencies']
      .some(k => JSON.stringify(before[k] || {}) !== JSON.stringify(after[k] || {}));
  } catch { return true; }
}

function installDependencies() {
  npm(fs.existsSync(path.join(root, 'package-lock.json'))
    ? ['ci','--no-audit','--no-fund']
    : ['install','--no-audit','--no-fund']);
}

async function checkUpdate() {
  if (busy || stopping) return;
  busy = true;
  let oldHead = null;
  let deps = false;
  try {
    if (processingCount() > 0) return;
    if (git(['status', '--porcelain', '--untracked-files=no']).stdout) return;
    const fetched = git(['fetch', '--quiet', 'origin', branch], true);
    if (fetched.status !== 0) return;
    oldHead = git(['rev-parse', 'HEAD']).stdout;
    const newHead = git(['rev-parse', `origin/${branch}`]).stdout;
    if (!oldHead || oldHead === newHead) return;
    if (git(['merge-base', '--is-ancestor', oldHead, newHead], true).status !== 0) return;
    deps = dependenciesChanged(oldHead, newHead);
    log(`phát hiện bản mới ${oldHead.slice(0,7)} -> ${newHead.slice(0,7)}`);
    writeSupervisorStatus({ status: 'UPDATING', old_head: oldHead.slice(0, 12), new_head: newHead.slice(0, 12) });
    await stopRuntime();
    git(['merge', '--ff-only', `origin/${branch}`]);
    if (deps) installDependencies();
    npm(['test']);
    log(`cập nhật thành công ${newHead.slice(0,7)}`);
    writeSupervisorStatus({ status: 'UPDATE_OK', git_head: newHead.slice(0, 12) });
    stopping = true;
    process.exit(0);
  } catch (error) {
    log(`cập nhật lỗi: ${String(error?.message || error)}`);
    writeSupervisorStatus({ status: 'UPDATE_FAILED', error: String(error?.message || error) });
    if (oldHead) {
      try {
        git(['reset', '--hard', oldHead]);
        if (deps) installDependencies();
        npm(['test']);
        log(`rollback OK về ${oldHead.slice(0,7)}`);
        writeSupervisorStatus({ status: 'ROLLBACK_OK', git_head: oldHead.slice(0, 12) });
      } catch (rollbackError) {
        log(`rollback lỗi: ${String(rollbackError?.message || rollbackError)}`);
        writeSupervisorStatus({ status: 'ROLLBACK_FAILED', error: String(rollbackError?.message || rollbackError) });
      }
    }
  } finally {
    busy = false;
    if (!stopping && !runtime) startRuntime();
  }
}

await lockSingleInstance();
console.log('Social Manager Facebook Operator Agent Supervisor');
console.log(`Auto update: ON | channel=${branch} | mỗi ${Math.round(intervalMs/1000)} giây`);
console.log(`Watchdog managed: ${watchdogManaged ? 'YES' : 'NO'}`);
if (process.platform === 'win32') {
  try {
    const r = installWindowsAgentAutostart({ root, nodePath: process.execPath });
    log(`Windows auto-start sẵn sàng mode=${r.mode}${r.task_existing ? ' (reused existing task)' : ''}`);
  } catch (error) { log(`Windows auto-start lỗi: ${String(error?.message || error)}`); }
}
writeSupervisorStatus({ status: 'STARTING' });
startRuntime();
setTimeout(checkUpdate, 1500);
setInterval(checkUpdate, intervalMs);
