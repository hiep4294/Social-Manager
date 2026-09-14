import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extensionActionPreferred,
  extensionActionSupported,
  extensionStatusIsHealthy
} from '../src/chrome-extension-bridge-core.js';

assert.equal(extensionActionSupported('create_page'), true);
assert.equal(extensionActionSupported('post_page'), true);
assert.equal(extensionActionSupported('post_group'), false);

const now = Date.now();
assert.equal(extensionStatusIsHealthy({ paired: true, last_heartbeat_at: new Date(now - 10_000).toISOString() }, { now, ttlMs: 45_000 }), true);
assert.equal(extensionStatusIsHealthy({ paired: true, last_heartbeat_at: new Date(now - 60_000).toISOString() }, { now, ttlMs: 45_000 }), false);
assert.equal(extensionStatusIsHealthy({ paired: false, last_heartbeat_at: new Date(now).toISOString() }, { now }), false);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-ext-'));
const statusPath = path.join(dir, 'status.json');
fs.writeFileSync(statusPath, JSON.stringify({ paired: true, last_heartbeat_at: new Date(now - 2_000).toISOString() }));
assert.equal(extensionActionPreferred('post_page', { statusPath, now }), true);
assert.equal(extensionActionPreferred('post_group', { statusPath, now }), false);
fs.rmSync(dir, { recursive: true, force: true });

console.log('Chrome Extension bridge core OK');
