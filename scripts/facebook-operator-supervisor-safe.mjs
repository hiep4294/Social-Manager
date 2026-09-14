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
let runtime = null;
let busy = false;
let stopping = false;

function log(text) {
  console.log(`Agent supervisor: ${text}`);
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

function startRuntime() {
  if (runtime || stopping) return;
  runtime = spawn(process.execPath, [runtimeFile], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: false });
  log(`runtime started pid=${runtime.pid}`);
  runtime.once('exit', () => {
    runtime = null;
    if (!stopping && !busy) setTimeout(startRuntime, 5000);
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
  const names = git(['diff', '--name-only', oldHead, newHead]).stdout.split(/\r?\n/);
  if (names.includes('package-lock.json') || names.includes('npm-shrinkwrap.json')) return true;
  if (!names.includes('package.json')) return false;
  try {
    const before = JSON.parse(git(['show', `${oldHead}:package.json`]).stdout);
    const after = JSON.parse(git(['show', `${newHead}:package.json`]).stdout);
    return ['dependencies','devDependencies','optionalDependencies','peerDependencies']
      .some(k => JSON.stringify(before[k] || {}) !== JSON.stringify(after[k] || {}));
  } catch { return true; }
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
    await stopRuntime();
    git(['merge', '--ff-only', `origin/${branch}`]);
    if (deps) npm(fs.existsSync(path.join(root, 'package-lock.json')) ? ['ci','--no-audit','--no-fund'] : ['install','--no-audit','--no-fund']);
    npm(['test']);
    log(`cập nhật thành công ${newHead.slice(0,7)}`);
    stopping = true;
    process.exit(0);
  } catch (error) {
    log(`cập nhật lỗi: ${String(error?.message || error)}`);
    if (oldHead) {
      try { git(['reset', '--hard', oldHead]); } catch {}
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
startRuntime();
setTimeout(checkUpdate, 1500);
setInterval(checkUpdate, intervalMs);
