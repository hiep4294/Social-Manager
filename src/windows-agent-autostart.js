import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'SocialManagerFacebookOperatorAgent';

function runReg(args, { allowFailure = false } = {}) {
  const result = spawnSync('reg.exe', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw result.error || new Error((result.stderr || result.stdout || 'reg.exe lỗi').trim());
  }
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null
  };
}

function vbsEscape(value) {
  return String(value || '').replace(/"/g, '""');
}

function writeIfChanged(file, content) {
  let current = null;
  try { current = fs.readFileSync(file, 'utf8'); } catch {}
  if (current === content) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

export function windowsAutostartPaths(root, nodePath = process.execPath) {
  const dataDir = path.join(root, 'data');
  const supervisor = path.join(root, 'scripts', 'start-facebook-operator-agent.mjs');
  const cmdPath = path.join(dataDir, 'start-facebook-operator-agent-background.cmd');
  const vbsPath = path.join(dataDir, 'start-facebook-operator-agent-background.vbs');
  const logPath = path.join(dataDir, 'operator-agent-background.log');
  return { dataDir, supervisor, cmdPath, vbsPath, logPath, nodePath };
}

export function installWindowsAgentAutostart({ root, nodePath = process.execPath } = {}) {
  if (process.platform !== 'win32') return { ok: false, skipped: true, reason: 'WINDOWS_ONLY' };
  if (!root) throw new Error('Thiếu root để cấu hình Windows auto-start');

  const paths = windowsAutostartPaths(root, nodePath);
  fs.mkdirSync(paths.dataDir, { recursive: true });

  const cmd = [
    '@echo off',
    `cd /d "${paths.dataDir.replace(/\\data$/, '')}"`,
    `"${paths.nodePath}" "${paths.supervisor}" >> "${paths.logPath}" 2>&1`,
    ''
  ].join('\r\n');

  const vbs = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run Chr(34) & "${vbsEscape(paths.cmdPath)}" & Chr(34), 0, False`,
    'Set shell = Nothing',
    ''
  ].join('\r\n');

  const cmdChanged = writeIfChanged(paths.cmdPath, cmd);
  const vbsChanged = writeIfChanged(paths.vbsPath, vbs);
  const runCommand = `wscript.exe //B //Nologo "${paths.vbsPath}"`;

  runReg([
    'add', RUN_KEY,
    '/v', RUN_VALUE,
    '/t', 'REG_SZ',
    '/d', runCommand,
    '/f'
  ]);

  return {
    ok: true,
    installed: true,
    changed: cmdChanged || vbsChanged,
    run_key: RUN_KEY,
    run_value: RUN_VALUE,
    command: runCommand,
    log_path: paths.logPath
  };
}

export function getWindowsAgentAutostartStatus() {
  if (process.platform !== 'win32') return { ok: false, skipped: true, reason: 'WINDOWS_ONLY' };
  const result = runReg(['query', RUN_KEY, '/v', RUN_VALUE], { allowFailure: true });
  return {
    ok: true,
    installed: result.status === 0,
    output: result.stdout || result.stderr
  };
}

export function removeWindowsAgentAutostart({ root, nodePath = process.execPath } = {}) {
  if (process.platform !== 'win32') return { ok: false, skipped: true, reason: 'WINDOWS_ONLY' };
  runReg(['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], { allowFailure: true });

  if (root) {
    const paths = windowsAutostartPaths(root, nodePath);
    for (const file of [paths.cmdPath, paths.vbsPath]) {
      try { fs.unlinkSync(file); } catch {}
    }
  }

  return { ok: true, installed: false, run_key: RUN_KEY, run_value: RUN_VALUE };
}
