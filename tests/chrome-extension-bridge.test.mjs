import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extensionActionPreferred,
  extensionActionSupported,
  extensionStatusIsHealthy
} from '../src/chrome-extension-bridge-core.js';

assert.equal(extensionActionSupported('generate_food_image'), true);
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

const manifest = JSON.parse(
  fs.readFileSync(path.resolve('chrome-extension', 'manifest.json'), 'utf8')
);
const bridgeClientSource = fs.readFileSync(
  path.resolve('chrome-extension', 'bridge-client.js'),
  'utf8'
);
const extensionVersionMatch = bridgeClientSource.match(
  /EXTENSION_VERSION\s*=\s*['"]([^'"]+)['"]/
);
assert.ok(extensionVersionMatch, 'bridge-client phải khai báo EXTENSION_VERSION');
assert.equal(
  extensionVersionMatch[1],
  manifest.version,
  'EXTENSION_VERSION phải trùng manifest.version'
);

const bridgeSource = fs.readFileSync(
  path.resolve('src', 'chrome-extension-bridge.js'),
  'utf8'
);
assert.match(
  bridgeSource,
  /extension_version:\s*extensionVersion/,
  'health endpoint phải trả extension_version'
);
assert.match(
  bridgeSource,
  /reload_required:\s*Boolean\(extensionVersion && extensionVersion !== expectedVersion\)/,
  'health endpoint phải báo reload_required khi version lệch'
);

console.log('Chrome Extension bridge core OK');
