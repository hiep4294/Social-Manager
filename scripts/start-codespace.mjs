import 'dotenv/config';
import crypto from 'node:crypto';

const port = String(process.env.PORT || '3000');
const codespace = process.env.CODESPACE_NAME;
const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';

function nonEmpty(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) return null;
  process.env[name] = value;
  return value;
}

if (!codespace) {
  console.error('CODESPACE_START_BLOCKED: script này chỉ dùng trong GitHub Codespaces.');
  process.exit(2);
}

process.env.PORT = port;
process.env.PUBLIC_BASE_URL ||= `https://${codespace}-${port}.${forwardingDomain}`;
process.env.COOKIE_SECURE ||= 'true';
process.env.DEMO_MODE = 'false';
process.env.META_GRAPH_VERSION ||= 'v26.0';
process.env.ADMIN_USER = nonEmpty('ADMIN_USER') || 'admin';
process.env.ADMIN_PASSWORD = nonEmpty('ADMIN_PASSWORD') || `sm-${crypto.randomBytes(9).toString('base64url')}`;
process.env.SESSION_SECRET = nonEmpty('SESSION_SECRET') || crypto.randomBytes(32).toString('hex');
process.env.TOKEN_ENCRYPTION_KEY = nonEmpty('TOKEN_ENCRYPTION_KEY') || crypto.randomBytes(32).toString('hex');

const metaAppId = nonEmpty('META_APP_ID');
const metaAppSecret = nonEmpty('META_APP_SECRET');
const redirectUri = process.env.META_REDIRECT_URI || `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/meta/oauth/callback`;

console.log('Social Manager - GitHub Codespaces LIVE mode');
console.log(`URL: ${process.env.PUBLIC_BASE_URL}`);
console.log(`Meta Graph API: ${process.env.META_GRAPH_VERSION}`);
console.log(`Meta OAuth redirect URI: ${redirectUri}`);
console.log(`META_APP_ID: ${metaAppId ? 'OK' : 'MISSING'}`);
console.log(`META_APP_SECRET: ${metaAppSecret ? 'OK' : 'MISSING'}`);
console.log(`Login: ${process.env.ADMIN_USER} / ${process.env.ADMIN_PASSWORD}`);
console.log('DEMO_MODE=false: bài đăng sẽ gọi Meta API thật khi tài khoản đã được kết nối.');

if (!metaAppId || !metaAppSecret) {
  console.error('\nLIVE_OAUTH_NOT_READY');
  console.error('Thiếu META_APP_ID hoặc META_APP_SECRET.');
  console.error('Có thể dùng Codespaces secrets hoặc file .env cục bộ trong Codespace (file .env đã bị .gitignore bỏ qua).');
  console.error('Sau khi cấu hình, chạy lại: npm run codespace');
  console.error(`Redirect URI cần khai báo trong Meta App: ${redirectUri}`);
  process.exit(2);
}

await import('../src/server.js');
