import 'dotenv/config';

process.env.FB_OPERATOR_ENABLED = 'true';
process.env.FB_OPERATOR_HEADLESS ||= 'false';
process.env.FB_OPERATOR_COMMAND_POLL_ENABLED = 'true';
process.env.FB_OPERATOR_COMMAND_POLL_MS ||= '5000';
process.env.GROUP_MONITOR_ENABLED ||= 'true';
process.env.GROUP_MONITOR_SCHEDULER_MS ||= '60000';
process.env.GROUP_MONITOR_MAX_REPLIES_PER_SCAN ||= '2';
process.env.GROUP_MONITOR_REPLY_DELAY_MS ||= '8000';
process.env.GITHUB_BRIDGE_COMMAND_URL ||= 'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/facebook-command.json';

console.log('Social Manager Facebook Operator Agent V1.6.1');
console.log('Browser mode: persistent local Chrome profile');
console.log('Group Monitor: ON (mặc định 10 phút, tối thiểu 5 phút, rate limit + chống trùng + chặn nội dung rủi ro).');
console.log('Login/CAPTCHA/2FA/checkpoint: luôn yêu cầu người dùng xử lý, không bypass.');

await import('../src/operator-command-poller.js');
await import('../src/group-monitor-scheduler.js');
await import('../src/facebook-operator-worker.js');
