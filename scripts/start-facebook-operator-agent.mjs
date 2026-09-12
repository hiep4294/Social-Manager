import 'dotenv/config';

process.env.FB_OPERATOR_ENABLED = 'true';
process.env.FB_OPERATOR_HEADLESS ||= 'false';
process.env.FB_OPERATOR_COMMAND_POLL_ENABLED = 'true';
process.env.FB_OPERATOR_COMMAND_POLL_MS ||= '5000';
process.env.GITHUB_BRIDGE_COMMAND_URL ||= 'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/facebook-command.json';

console.log('Social Manager Facebook Operator Agent');
console.log('Browser mode: persistent local Chrome profile');
console.log('Login/CAPTCHA/2FA/checkpoint: luôn yêu cầu người dùng xử lý, không bypass.');

await import('../src/operator-command-poller.js');
await import('../src/facebook-operator-worker.js');
