import crypto from 'node:crypto';

const port = String(process.env.PORT || '3000');
const codespace = process.env.CODESPACE_NAME;
const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';

if (!codespace) {
  console.error('CODESPACE_START_BLOCKED: script này chỉ dùng trong GitHub Codespaces.');
  process.exit(2);
}

process.env.PORT = port;
process.env.PUBLIC_BASE_URL ||= `https://${codespace}-${port}.${forwardingDomain}`;
process.env.COOKIE_SECURE ||= 'true';
process.env.DEMO_MODE = 'false';
process.env.META_GRAPH_VERSION ||= 'v26.0';
process.env.ADMIN_USER ||= 'admin';
process.env.ADMIN_PASSWORD ||= `sm-${crypto.randomBytes(9).toString('base64url')}`;
process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
process.env.TOKEN_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('hex');

const redirectUri = process.env.META_REDIRECT_URI || `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/meta/oauth/callback`;

console.log('Social Manager - GitHub Codespaces LIVE mode');
console.log(`URL: ${process.env.PUBLIC_BASE_URL}`);
console.log(`Meta Graph API: ${process.env.META_GRAPH_VERSION}`);
console.log(`Meta OAuth redirect URI: ${redirectUri}`);
console.log(`Login: ${process.env.ADMIN_USER} / ${process.env.ADMIN_PASSWORD}`);
console.log('DEMO_MODE=false: bài đăng sẽ gọi Meta API thật khi tài khoản đã được kết nối.');

if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
  console.error('\nLIVE_OAUTH_NOT_READY');
  console.error('Thiếu META_APP_ID hoặc META_APP_SECRET.');
  console.error('Hãy thêm hai giá trị này vào Codespaces secrets rồi chạy lại: npm run codespace');
  console.error(`Sau đó thêm Redirect URI này vào Meta App: ${redirectUri}`);
  process.exit(2);
}

await import('../src/server.js');
