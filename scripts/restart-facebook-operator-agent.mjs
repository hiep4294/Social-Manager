import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const supervisor = path.join(__dirname, 'start-facebook-operator-agent.mjs');
const parentPid = Number(process.argv[2] || 0);
const logPath = path.join(root, 'data', 'operator-agent-restart.log');

fs.mkdirSync(path.dirname(logPath), { recursive: true });

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

for (let i = 0; i < 40 && alive(parentPid); i += 1) {
  await new Promise(resolve => setTimeout(resolve, 250));
}

const fd = fs.openSync(logPath, 'a');
const child = spawn(process.execPath, [supervisor], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: ['ignore', fd, fd],
  windowsHide: true
});
child.unref();
try { fs.closeSync(fd); } catch {}
