import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const target = String(process.argv[2] || '').trim();
if (!target) throw new Error('Usage: node scripts/page-complete-session.mjs <facebook-page-url>');

const statusFile = path.join(root, 'public', 'page-complete-session.json');
const logFile = path.join(root, 'data', 'page-complete-session.log');
fs.mkdirSync(path.dirname(statusFile), { recursive: true });
fs.mkdirSync(path.dirname(logFile), { recursive: true });

function now(){ return new Date().toISOString(); }
function writeStatus(extra={}){
  fs.writeFileSync(statusFile, JSON.stringify({ target, ...extra, updated_at: now() }, null, 2), 'utf8');
}
function append(text){
  fs.appendFileSync(logFile, '[' + now() + '] ' + String(text) + '\n', 'utf8');
}
function runNode(script, args=[]){
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env: process.env,
      stdio: ['ignore','pipe','pipe'],
      windowsHide: false
    });
    child.stdout.on('data', d => append(d.toString().trimEnd()));
    child.stderr.on('data', d => append(d.toString().trimEnd()));
    child.once('exit', code => resolve(code ?? 1));
  });
}

writeStatus({ status:'WAITING_USER_LOGIN', message:'Chrome sẽ mở. Đăng nhập/xác minh Facebook thủ công rồi đóng cửa sổ Chrome.' });
append('SESSION START target=' + target);

const loginCode = await runNode(path.join(root,'scripts','operator-login.mjs'));
if (loginCode !== 0) {
  writeStatus({ status:'LOGIN_FAILED', exit_code:loginCode });
  process.exit(loginCode);
}

writeStatus({ status:'RUNNING_PAGE_COMPLETE', message:'Đã lưu phiên Facebook, đang hoàn thiện Page.' });
const completeCode = await runNode(path.join(root,'scripts','page-complete.mjs'), [target]);

if (process.platform === 'win32') {
  try {
    const child = spawn('schtasks.exe', ['/Run','/TN','SocialManagerFacebookOperatorAgent'], {
      cwd: root, windowsHide:true, stdio:'ignore'
    });
    await new Promise(r => child.once('exit', r));
  } catch {}
}

writeStatus({
  status: completeCode === 0 ? 'DONE' : 'NEEDS_REVIEW',
  exit_code: completeCode,
  message: completeCode === 0 ? 'Hoàn thiện Page đã chạy xong.' : 'Page completion cần kiểm tra log.'
});
append('SESSION END code=' + completeCode);
process.exit(completeCode);
