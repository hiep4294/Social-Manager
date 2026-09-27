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
assert.equal(extensionActionSupported('create_page'), false);
assert.equal(extensionActionSupported('post_page'), false);
assert.equal(extensionActionSupported('post_group'), false);

const now = Date.now();
assert.equal(extensionStatusIsHealthy({ paired: true, last_heartbeat_at: new Date(now - 10_000).toISOString() }, { now, ttlMs: 45_000 }), true);
assert.equal(extensionStatusIsHealthy({ paired: true, last_heartbeat_at: new Date(now - 60_000).toISOString() }, { now, ttlMs: 45_000 }), false);
assert.equal(extensionStatusIsHealthy({ paired: false, last_heartbeat_at: new Date(now).toISOString() }, { now }), false);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-ext-'));
const statusPath = path.join(dir, 'status.json');
fs.writeFileSync(statusPath, JSON.stringify({ paired: true, last_heartbeat_at: new Date(now - 2_000).toISOString() }));
assert.equal(extensionActionPreferred('post_page', { statusPath, now }), false);
assert.equal(extensionActionPreferred('post_group', { statusPath, now }), false);
fs.rmSync(dir, { recursive: true, force: true });

const contentChatGPTSource =
  fs.readFileSync(
    path.resolve(
      'chrome-extension',
      'content-chatgpt.js'
    ),
    'utf8'
  );

assert.match(
  contentChatGPTSource,
  /naturalWidth >= 512 && img\.naturalHeight >= 512/,
  'candidate ?nh ChatGPT ph?i t?i thi?u 512x512'
);

const runnerSource =
  fs.readFileSync(
    path.resolve(
      'chrome-extension',
      'chatgpt-runner.js'
    ),
    'utf8'
  );

assert.match(
  runnerSource,
  /obviousUiAsset/,
  'runner ph?i lo?i icon v? favicon'
);

assert.match(
  runnerSource,
  /downloadBaseline/,
  'runner ph?i b? qua download c?'
);

const facebookContentSource =
  fs.readFileSync(
    path.resolve(
      'chrome-extension',
      'content-facebook.js'
    ),
    'utf8'
  );

assert.match(
  facebookContentSource,
  /20000/,
  'composer ph?i ch? Facebook render'
);

assert.match(
  facebookContentSource,
  /composer_candidates/,
  'composer failure ph?i l?u diagnostic candidates'
);

assert.match(
  facebookContentSource,
  /clicked_post:false/,
  'failure tr??c n?t ??ng ph?i ghi clicked_post=false'
);

console.log('Chrome Extension bridge core OK');
