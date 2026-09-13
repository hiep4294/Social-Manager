import 'dotenv/config';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const supervisorScript = path.join(__dirname, 'start-facebook-operator-agent.mjs');
const restartDelayMs = Math.max(3000, Number(process.env.FB_AGENT_WATCHDOG_RESTART_MS || 5000));
let child = null;
let shuttingDown = false;
let server = null;

async function acquireSingleInstance() {
  if (process.platform !== 'win32') return;
  const pipeName = '\\\\.\\pipe\\SocialManagerFacebookOperatorWatchdog-hiep4294';
  const candidate = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => {
    candidate.once('error', reject);
    candidate.listen(pipeName, () => {
      candidate.removeListener('error', reject);
      resolve();
    });
  }).catch(error => {
    if (String(error?.code || '') === 'EADDRINUSE') {
      console.log('Agent watchdog: một watchdog khác đang chạy; thoát phiên trùng.');
      process.exit(0);
    }
    throw error;
  });
  server = candidate;
}

function startSupervisor() {
  if (child || shuttingDown) return;
  const proc = spawn(process.execPath, [supervisorScript], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  child = proc;
  console.log(`Agent watchdog: supervisor started pid=${proc.pid}`);
  proc.on('exit', (code, signal) => {
    if (child === proc) child = null;
    if (shuttingDown) return;
    console.log(`Agent watchdog: supervisor stopped code=${code ?? 'null'} signal=${signal || 'none'}; restart in ${restartDelayMs}ms`);
    setTimeout(startSupervisor, restartDelayMs);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Agent watchdog: shutdown ${signal}`);
  if (child) {
    await new Promise(resolve => {
      const proc = child;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      proc.once('exit', finish);
      try { proc.kill('SIGTERM'); } catch { finish(); }
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        finish();
      }, 10000);
    });
  }
  try { server?.close(); } catch {}
  process.exit(0);
}

process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(0)); });
process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(0)); });

await acquireSingleInstance();
console.log('Social Manager Facebook Operator Watchdog');
startSupervisor();
