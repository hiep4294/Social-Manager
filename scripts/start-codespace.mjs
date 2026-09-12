import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const port = String(process.env.PORT || '3000');
const codespace = process.env.CODESPACE_NAME;
const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
const envPath = path.resolve(root, '.env');

function nonEmpty(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) return null;
  process.env[name] = value;
  return value;
}

function persistLocalValues(values) {
  let text = '';
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    text = '';
  }

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, line);
    else text += `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  }

  fs.writeFileSync(envPath, text, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(envPath, 0o600); } catch {}
}

function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return { version: 'unknown', dependencies: {} };
  }
}

function ensureRuntimeDependencies() {
  const pkg = readPackage();
  const required = Object.keys(pkg.dependencies || {});
  const missing = required.filter(name => !fs.existsSync(path.join(root, 'node_modules', name, 'package.json')));
  if (!missing.length) return;

  console.log(`Runtime dependencies thiếu (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}); tự chạy npm install...`);
  const result = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error('AUTO_INSTALL_FAILED: npm install không thành công.');
    process.exit(result.status || 1);
  }
}

if (!codespace) {
  console.error('CODESPACE_START_BLOCKED: script này chỉ dùng trong GitHub Codespaces.');
  process.exit(2);
}

ensureRuntimeDependencies();

process.env.PORT = port;
process.env.PUBLIC_BASE_URL ||= `https://${codespace}-${port}.${forwardingDomain}`;
process.env.COOKIE_SECURE ||= 'true';
process.env.DEMO_MODE = 'false';
process.env.META_GRAPH_VERSION ||= 'v26.0';
process.env.ADMIN_USER = nonEmpty('ADMIN_USER') || 'admin';
process.env.GITHUB_BRIDGE_ENABLED ||= 'true';
process.env.GITHUB_BRIDGE_COMMAND_URL ||= 'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/facebook-command.json';
process.env.PAGE_AUTO_REPLY_ENABLED ||= 'true';
process.env.PAGE_AUTO_REPLY_MODE ||= 'safe';
process.env.PAGE_AUTO_REPLY_POLL_MS ||= '60000';
process.env.FB_OPERATOR_ENABLED ||= 'true';
process.env.FB_OPERATOR_HEADLESS ||= 'true';
process.env.AUTO_UPDATE_ENABLED ||= 'true';
process.env.AUTO_UPDATE_MANIFEST_URL ||= 'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/runtime-version.json';
process.env.AUTO_UPDATE_CHECK_MS ||= '60000';

const existingAdminPassword = nonEmpty('ADMIN_PASSWORD');
const existingSessionSecret = nonEmpty('SESSION_SECRET');
const existingEncryptionKey = nonEmpty('TOKEN_ENCRYPTION_KEY');

process.env.ADMIN_PASSWORD = existingAdminPassword || `sm-${crypto.randomBytes(9).toString('base64url')}`;
process.env.SESSION_SECRET = existingSessionSecret || crypto.randomBytes(32).toString('hex');
process.env.TOKEN_ENCRYPTION_KEY = existingEncryptionKey || crypto.randomBytes(32).toString('hex');

const generated = {};
if (!existingAdminPassword) generated.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!existingSessionSecret) generated.SESSION_SECRET = process.env.SESSION_SECRET;
if (!existingEncryptionKey) generated.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
if (Object.keys(generated).length) persistLocalValues(generated);

const metaAppId = nonEmpty('META_APP_ID');
const metaAppSecret = nonEmpty('META_APP_SECRET');
const redirectUri = process.env.META_REDIRECT_URI || `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/meta/oauth/callback`;
const packageVersion = readPackage().version || 'unknown';

console.log(`Social Manager ${packageVersion} - GitHub Codespaces LIVE mode`);
console.log(`URL: ${process.env.PUBLIC_BASE_URL}`);
console.log(`Meta Graph API: ${process.env.META_GRAPH_VERSION}`);
console.log(`Meta OAuth redirect URI: ${redirectUri}`);
console.log(`META_APP_ID: ${metaAppId ? 'OK' : 'MISSING'}`);
console.log(`META_APP_SECRET: ${metaAppSecret ? 'OK' : 'MISSING'}`);
console.log(`Login: ${process.env.ADMIN_USER} / ${process.env.ADMIN_PASSWORD}`);
console.log('Runtime ADMIN_PASSWORD / SESSION_SECRET / TOKEN_ENCRYPTION_KEY được giữ ổn định trong .env cục bộ của Codespace.');
console.log('DEMO_MODE=false: bài đăng sẽ gọi Meta API thật khi tài khoản đã được kết nối.');
console.log('GitHub bridge: ON (nhận lệnh Facebook trực tiếp từ chat).');
console.log('Page auto reply: ON / safe mode (LOW tự trả lời, MEDIUM/HIGH chờ xử lý).');
console.log('Facebook operator: ON (tự dừng nếu thiếu browser, login, CAPTCHA, 2FA hoặc checkpoint).');
console.log('Auto update: ON (tự kiểm tra phiên bản mới và tự khởi động lại).');

if (!metaAppId || !metaAppSecret) {
  console.error('\nLIVE_OAUTH_NOT_READY');
  console.error('Thiếu META_APP_ID hoặc META_APP_SECRET.');
  console.error('Có thể dùng Codespaces secrets hoặc file .env cục bộ trong Codespace (file .env đã bị .gitignore bỏ qua).');
  console.error('Sau khi cấu hình, chạy lại: npm run codespace');
  console.error(`Redirect URI cần khai báo trong Meta App: ${redirectUri}`);
  process.exit(2);
}

await import('../src/server.js');
await import('../src/github-bridge.js');
await import('../src/page-auto-reply-worker.js');
await import('../src/facebook-operator-worker.js');
await import('../src/runtime-auto-update.js');
