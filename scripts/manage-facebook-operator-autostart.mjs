import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getWindowsAgentAutostartStatus,
  installWindowsAgentAutostart,
  removeWindowsAgentAutostart
} from '../src/windows-agent-autostart.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const action = String(process.argv[2] || 'status').trim().toLowerCase();

if (process.platform !== 'win32') {
  console.error('Chức năng auto-start này chỉ dùng cho Windows.');
  process.exit(2);
}

if (action === 'install') {
  const result = installWindowsAgentAutostart({ root, nodePath: process.execPath });
  console.log(`AUTO_START_INSTALLED: ${result.command}`);
  console.log(`LOG: ${result.log_path}`);
} else if (action === 'remove' || action === 'uninstall') {
  removeWindowsAgentAutostart({ root, nodePath: process.execPath });
  console.log('AUTO_START_REMOVED');
} else if (action === 'status') {
  const result = getWindowsAgentAutostartStatus();
  console.log(result.installed ? 'AUTO_START_ON' : 'AUTO_START_OFF');
  if (result.output) console.log(result.output);
} else {
  console.error('Cách dùng: node scripts/manage-facebook-operator-autostart.mjs install|status|remove');
  process.exit(2);
}
