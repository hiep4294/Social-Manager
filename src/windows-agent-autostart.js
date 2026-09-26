import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'SocialManagerFacebookOperatorAgent';
const TASK_NAME = 'SocialManagerFacebookOperatorAgent';

function runExe(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw result.error || new Error((result.stderr || result.stdout || `${command} lỗi`).trim());
  }
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null
  };
}

function runReg(args, options) {
  return runExe('reg.exe', args, options);
}

function runTask(args, options) {
  return runExe('schtasks.exe', args, options);
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
  const watchdog = path.join(root, 'scripts', 'facebook-operator-agent-watchdog.mjs');
  const cmdPath = path.join(dataDir, 'start-facebook-operator-agent-background.cmd');
  const vbsPath = path.join(dataDir, 'start-facebook-operator-agent-background.vbs');
  const logPath = path.join(dataDir, 'operator-agent-background.log');
  return { dataDir, watchdog, cmdPath, vbsPath, logPath, nodePath };
}

function installRegistryFallback(runCommand) {
  runReg([
    'add', RUN_KEY,
    '/v', RUN_VALUE,
    '/t', 'REG_SZ',
    '/d', runCommand,
    '/f'
  ]);
  return 'REGISTRY_RUN';
}

function existingScheduledTask() {
  return runTask(['/Query', '/TN', TASK_NAME], { allowFailure: true });
}

export function installWindowsAgentAutostart({ root, nodePath = process.execPath } = {}) {
  if (process.platform !== 'win32') return { ok: false, skipped: true, reason: 'WINDOWS_ONLY' };
  if (!root) throw new Error('Thiếu root để cấu hình Windows auto-start');

  const paths = windowsAutostartPaths(root, nodePath);
  fs.mkdirSync(paths.dataDir, { recursive: true });

  const bundledGitCmd = path.join(root, 'runtime', 'git', 'cmd');
  const bundledNodeDir = path.dirname(paths.nodePath);
  const runtimePathParts = [bundledGitCmd, bundledNodeDir].filter(item => fs.existsSync(item));

  const cmd = [
    '@echo off',
    runtimePathParts.length ? `set "PATH=${runtimePathParts.join(';')};%PATH%"` : null,
    `cd /d "${root}"`,
    `"${paths.nodePath}" "${paths.watchdog}" >> "${paths.logPath}" 2>&1`,
    ''
  ].filter(Boolean).join('\r\n');

  const vbs = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run Chr(34) & "${vbsEscape(paths.cmdPath)}" & Chr(34), 0, False`,
    'Set shell = Nothing',
    ''
  ].join('\r\n');

  const cmdChanged = writeIfChanged(paths.cmdPath, cmd);
  const vbsChanged = writeIfChanged(paths.vbsPath, vbs);
  const runCommand = `wscript.exe //B //Nologo "${paths.vbsPath}"`;

  let mode = null;
  let taskError = null;
  let taskExisting = false;

  // Important: do not recreate an existing scheduled task on every Agent start.
  // A task created from an elevated shell may be queryable/runnable later but not
  // replaceable by a normal user process. Re-running /Create /F in that state
  // returns "Access is denied" and previously caused an unnecessary Registry
  // fallback, producing two logon triggers. The task target is the stable VBS
  // path, whose contents are refreshed above, so an existing task remains valid.
  const existing = existingScheduledTask();
  if (existing.status === 0) {
    mode = 'TASK_SCHEDULER';
    taskExisting = true;
    runReg(['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], { allowFailure: true });
  } else {
    const task = runTask([
      '/Create',
      '/TN', TASK_NAME,
      '/SC', 'ONLOGON',
      '/TR', runCommand,
      '/RL', 'LIMITED',
      '/F'
    ], { allowFailure: true });

    if (task.status === 0) {
      mode = 'TASK_SCHEDULER';
      runReg(['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], { allowFailure: true });
    } else {
      taskError = task.stderr || task.stdout || 'schtasks.exe lỗi';
      mode = installRegistryFallback(runCommand);
    }
  }

  return {
    ok: true,
    installed: true,
    changed: cmdChanged || vbsChanged,
    mode,
    task_existing: taskExisting,
    task_name: TASK_NAME,
    run_key: RUN_KEY,
    run_value: RUN_VALUE,
    command: runCommand,
    log_path: paths.logPath,
    task_error: taskError
  };
}

export function getWindowsAgentAutostartStatus() {
  if (process.platform !== 'win32') return { ok: false, skipped: true, reason: 'WINDOWS_ONLY' };
  const task = runTask(['/Query', '/TN', TASK_NAME], { allowFailure: true });
  const registry = runReg(['query', RUN_KEY, '/v', RUN_VALUE], { allowFailure: true });
  return {
    ok: true,
    installed: task.status === 0 || registry.status === 0,
    mode: task.status === 0 ? 'TASK_SCHEDULER' : registry.status === 0 ? 'REGISTRY_RUN' : null,
    task_installed: task.status === 0,
    registry_installed: registry.status === 0,
    task_output: task.stdout || task.stderr,
    registry_output: registry.stdout || registry.stderr
  };
}

export function removeWindowsAgentAutostart({ root, nodePath = process.execPath } = {}) {
  if (process.platform !== 'win32') return { ok: false, skipped: true, reason: 'WINDOWS_ONLY' };
  runTask(['/Delete', '/TN', TASK_NAME, '/F'], { allowFailure: true });
  runReg(['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], { allowFailure: true });

  if (root) {
    const paths = windowsAutostartPaths(root, nodePath);
    for (const file of [paths.cmdPath, paths.vbsPath]) {
      try { fs.unlinkSync(file); } catch {}
    }
  }

  return {
    ok: true,
    installed: false,
    task_name: TASK_NAME,
    run_key: RUN_KEY,
    run_value: RUN_VALUE
  };
}
