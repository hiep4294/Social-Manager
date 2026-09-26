import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TASK_NAME = 'SocialManagerFoodLocalAgent';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'SocialManagerFoodLocalAgent';

function runExe(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding:'utf8',
    stdio:['ignore','pipe','pipe'],
    windowsHide:true
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw result.error || new Error((result.stderr || result.stdout || `${command} lỗi`).trim());
  }
  return {
    status:result.status ?? (result.error ? 1 : 0),
    stdout:String(result.stdout || '').trim(),
    stderr:String(result.stderr || '').trim()
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

export function foodAgentAutostartPaths(root, nodePath = process.execPath) {
  const dataDir = path.join(root, 'data');
  return {
    dataDir,
    agent:path.join(root, 'scripts', 'food-local-agent.mjs'),
    cmdPath:path.join(dataDir, 'start-food-local-agent-background.cmd'),
    vbsPath:path.join(dataDir, 'start-food-local-agent-background.vbs'),
    logPath:path.join(dataDir, 'food-local-agent-background.log'),
    nodePath
  };
}

export function installWindowsFoodAgentAutostart({ root, nodePath = process.execPath } = {}) {
  if (process.platform !== 'win32') return { ok:false, skipped:true, reason:'WINDOWS_ONLY' };
  if (!root) throw new Error('Thiếu root để cấu hình Food Local Agent auto-start');

  const p = foodAgentAutostartPaths(root, nodePath);
  fs.mkdirSync(p.dataDir, { recursive:true });

  const bundledGitCmd = path.join(root, 'runtime', 'git', 'cmd');
  const bundledNodeDir = path.dirname(p.nodePath);
  const runtimePathParts = [bundledGitCmd, bundledNodeDir].filter(x => fs.existsSync(x));

  const cmd = [
    '@echo off',
    runtimePathParts.length ? `set "PATH=${runtimePathParts.join(';')};%PATH%"` : null,
    `cd /d "${root}"`,
    `"${p.nodePath}" "${p.agent}" >> "${p.logPath}" 2>&1`,
    ''
  ].filter(Boolean).join('\r\n');

  const vbs = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run Chr(34) & "${vbsEscape(p.cmdPath)}" & Chr(34), 0, False`,
    'Set shell = Nothing',
    ''
  ].join('\r\n');

  writeIfChanged(p.cmdPath, cmd);
  writeIfChanged(p.vbsPath, vbs);

  const runCommand = `wscript.exe //B //Nologo "${p.vbsPath}"`;
  const query = runExe('schtasks.exe', ['/Query','/TN',TASK_NAME], { allowFailure:true });

  let mode = null;
  if (query.status === 0) {
    mode = 'TASK_SCHEDULER';
    runExe('reg.exe', ['delete',RUN_KEY,'/v',RUN_VALUE,'/f'], { allowFailure:true });
  } else {
    const task = runExe('schtasks.exe', [
      '/Create','/TN',TASK_NAME,'/SC','ONLOGON','/TR',runCommand,'/RL','LIMITED','/F'
    ], { allowFailure:true });

    if (task.status === 0) {
      mode = 'TASK_SCHEDULER';
      runExe('reg.exe', ['delete',RUN_KEY,'/v',RUN_VALUE,'/f'], { allowFailure:true });
    } else {
      runExe('reg.exe', [
        'add',RUN_KEY,'/v',RUN_VALUE,'/t','REG_SZ','/d',runCommand,'/f'
      ]);
      mode = 'REGISTRY_RUN';
    }
  }

  return {
    ok:true,
    installed:true,
    mode,
    task_name:TASK_NAME,
    command:runCommand,
    log_path:p.logPath
  };
}

export function getWindowsFoodAgentAutostartStatus() {
  if (process.platform !== 'win32') return { ok:false, skipped:true, reason:'WINDOWS_ONLY' };
  const task = runExe('schtasks.exe', ['/Query','/TN',TASK_NAME], { allowFailure:true });
  const registry = runExe('reg.exe', ['query',RUN_KEY,'/v',RUN_VALUE], { allowFailure:true });
  return {
    ok:true,
    installed:task.status === 0 || registry.status === 0,
    mode:task.status === 0 ? 'TASK_SCHEDULER' : registry.status === 0 ? 'REGISTRY_RUN' : null
  };
}

export function startWindowsFoodAgent({ root, nodePath = process.execPath } = {}) {
  if (process.platform !== 'win32') return { ok:false, skipped:true, reason:'WINDOWS_ONLY' };
  if (!root) throw new Error('Thiếu root để khởi động Food Local Agent');

  const p = foodAgentAutostartPaths(root, nodePath);
  const status = getWindowsFoodAgentAutostartStatus();

  if (status.mode === 'TASK_SCHEDULER') {
    const task = runExe('schtasks.exe', ['/Run','/TN',TASK_NAME], { allowFailure:true });
    if (task.status === 0) {
      return {
        ok:true,
        started:true,
        mode:'TASK_SCHEDULER',
        task_name:TASK_NAME,
        log_path:p.logPath
      };
    }
  }

  if (!fs.existsSync(p.vbsPath)) {
    throw new Error(`Thiếu file khởi động Food Local Agent: ${p.vbsPath}`);
  }

  const vbs = runExe('wscript.exe', ['//B','//Nologo',p.vbsPath], { allowFailure:true });
  if (vbs.status !== 0) {
    throw new Error(vbs.stderr || vbs.stdout || 'Không khởi động được Food Local Agent bằng VBS');
  }

  return {
    ok:true,
    started:true,
    mode:status.mode || 'DIRECT_VBS',
    task_name:TASK_NAME,
    log_path:p.logPath
  };
}

export function removeWindowsFoodAgentAutostart({ root, nodePath = process.execPath } = {}) {
  if (process.platform !== 'win32') return { ok:false, skipped:true, reason:'WINDOWS_ONLY' };
  runExe('schtasks.exe', ['/Delete','/TN',TASK_NAME,'/F'], { allowFailure:true });
  runExe('reg.exe', ['delete',RUN_KEY,'/v',RUN_VALUE,'/f'], { allowFailure:true });

  if (root) {
    const p = foodAgentAutostartPaths(root, nodePath);
    for (const file of [p.cmdPath,p.vbsPath]) {
      try { fs.unlinkSync(file); } catch {}
    }
  }

  return { ok:true, installed:false, task_name:TASK_NAME };
}
