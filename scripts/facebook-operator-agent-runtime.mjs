import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
let version = 'unknown';
try {
  version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || version;
} catch {}

process.env.FB_OPERATOR_ENABLED = 'true';
process.env.FB_OPERATOR_HEADLESS ||= 'false';
process.env.FB_OPERATOR_COMMAND_POLL_ENABLED = 'true';
process.env.FB_OPERATOR_COMMAND_POLL_MS ||= '5000';
process.env.FB_OPERATOR_COMMAND_QUEUE_URL ||= 'https://raw.githubusercontent.com/hiep4294/Social-Manager/main/bridge/operator-queue.json';
process.env.FB_OPERATOR_ALLOW_LEGACY_COMMAND ||= 'false';
process.env.FB_AGENT_REQUIRE_KNOWN_GROUP ||= 'true';
process.env.FB_OPERATOR_RELIABILITY_ENABLED ||= 'true';
process.env.FB_OPERATOR_HEARTBEAT_MS ||= '15000';
process.env.FB_OPERATOR_JOB_LEASE_MS ||= '600000';
process.env.FB_OPERATOR_MAX_ATTEMPTS ||= '3';
process.env.FB_OPERATOR_BACKUP_MS ||= String(24 * 60 * 60 * 1000);
process.env.FB_OPERATOR_BACKUP_KEEP ||= '7';
process.env.OPERATOR_SELF_HEALING_ENABLED ||= 'true';
process.env.OPERATOR_SELF_HEALING_TICK_MS ||= '30000';
process.env.OPERATOR_SELF_HEALING_MAX_ATTEMPTS ||= '3';
process.env.OPERATOR_SELF_HEALING_BASE_DELAY_MS ||= '60000';
process.env.OPERATOR_SELF_HEALING_MAX_DELAY_MS ||= String(30 * 60 * 1000);
process.env.OPERATOR_TEMP_MAX_AGE_MS ||= String(6 * 60 * 60 * 1000);
process.env.GROUP_MONITOR_ENABLED ||= 'true';
process.env.GROUP_MONITOR_SCHEDULER_MS ||= '60000';
process.env.GROUP_MONITOR_MAX_REPLIES_PER_SCAN ||= '2';
process.env.GROUP_MONITOR_REPLY_DELAY_MS ||= '8000';
process.env.FOOD_NETWORK_AUTO_ENABLED ||= 'true';
process.env.FOOD_NETWORK_TICK_MS ||= '60000';
process.env.FOOD_NETWORK_POST_WINDOW_START_MINUTE ||= '660';
process.env.FOOD_NETWORK_POST_WINDOW_MINUTES ||= '540';
process.env.FOOD_NETWORK_PAGE_CATEGORY ||= 'Food & beverage';

console.log(`Social Manager Facebook Operator Agent V${version}`);
console.log('Browser mode: persistent local Chrome profile');
console.log('Command queue: replay protection + expiry + known-Group guard + rate limit.');
console.log('Reliability: heartbeat + stale-job recovery + SQLite backup.');
console.log('Self-healing: bounded transient retry + state repair + diagnostics + temp cleanup.');
console.log('Group Monitor: ON (mặc định 10 phút, tối thiểu 5 phút, rate limit + chống trùng + chặn nội dung rủi ro).');
console.log('Food Network: AUTO 24 Pages/năm, 1 bài/ngày/Page, ảnh món ăn có giấy phép từ Wikimedia Commons.');
console.log('Login/CAPTCHA/2FA/checkpoint: luôn yêu cầu người dùng xử lý, không bypass.');

await import('../src/operator-command-poller.js');
await import('../src/operator-reliability-worker.js');
await import('../src/operator-self-healing-worker.js');
await import('../src/group-monitor-scheduler.js');
await import('../src/facebook-operator-worker.js');
await import('../src/food-network-worker.js');
