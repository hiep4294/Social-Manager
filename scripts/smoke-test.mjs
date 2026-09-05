import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'social-manager-smoke-'));
const port = 32000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

fs.cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });
fs.cpSync(path.join(repoRoot, 'public'), path.join(tempRoot, 'public'), { recursive: true });
fs.symlinkSync(
  path.join(repoRoot, 'node_modules'),
  path.join(tempRoot, 'node_modules'),
  process.platform === 'win32' ? 'junction' : 'dir'
);

const env = {
  ...process.env,
  PORT: String(port),
  SESSION_SECRET: 'smoke-session-secret',
  TOKEN_ENCRYPTION_KEY: 'smoke-token-encryption-key',
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'smoke-password',
  PUBLIC_BASE_URL: baseUrl,
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'true',
  FACEBOOK_PAGE_ID: 'smoke-facebook-page',
  FACEBOOK_PAGE_ACCESS_TOKEN: 'smoke-facebook-token',
  INSTAGRAM_USER_ID: 'smoke-instagram-user',
  INSTAGRAM_ACCESS_TOKEN: 'smoke-instagram-token'
};

const child = spawn(process.execPath, ['src/server.js'], {
  cwd: tempRoot,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

let cookie = '';

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready:\n${serverOutput}`);
}

async function request(urlPath, { method = 'GET', body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: payload });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    throw new Error(`${method} ${urlPath} -> ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

try {
  await waitForServer();

  const health = await request('/api/health');
  assert(health.ok === true, 'Health check failed');
  assert(health.version === 'V1.1.0', 'Unexpected version');

  const login = await request('/api/login', {
    method: 'POST',
    body: { user: 'admin', password: 'smoke-password' }
  });
  assert(login.ok === true && cookie, 'Login/session failed');

  const existingBrands = await request('/api/brands');
  assert(Array.isArray(existingBrands) && existingBrands.length >= 1, 'Default brand missing');

  const brand = await request('/api/brands', {
    method: 'POST',
    body: {
      kind: 'BRAND',
      name: 'Smoke Test Brand',
      slogan: 'Test',
      address: '1 Test Street',
      phone: '0000000000',
      opening_hours: '08:00-22:00',
      map_url: 'https://maps.example.test'
    }
  });
  assert(brand.id, 'Create brand failed');

  const branch = await request('/api/brands', {
    method: 'POST',
    body: {
      kind: 'BRANCH',
      parent_id: brand.id,
      name: 'Smoke Test Branch',
      address: '2 Test Street'
    }
  });
  assert(branch.parent_id === brand.id, 'Create branch failed');

  const templates = await request(`/api/templates?brand_id=${branch.id}`);
  assert(Array.isArray(templates) && templates.length >= 1, 'Templates unavailable');

  const post = await request('/api/posts', {
    method: 'POST',
    body: {
      brand_id: branch.id,
      content: 'Smoke test post for Facebook and Instagram',
      image_url: 'https://example.com/smoke-test.jpg',
      platforms: ['facebook', 'instagram'],
      scheduled_at: null
    }
  });
  assert(post.id && post.targets.length === 2, 'Post creation failed');

  const deadline = Date.now() + 10000;
  let publishedPost;
  while (Date.now() < deadline) {
    const posts = await request(`/api/posts?brand_id=${branch.id}`);
    publishedPost = posts.find(item => item.id === post.id);
    if (publishedPost?.targets?.every(target => target.status === 'PUBLISHED')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(publishedPost?.targets?.every(target => target.status === 'PUBLISHED'), 'Demo scheduler/publishing failed');
  assert(publishedPost.targets.every(target => String(target.external_id || '').startsWith('demo-')), 'Demo external IDs missing');

  const start = new Date(Date.now() - 3600000).toISOString();
  const end = new Date(Date.now() + 3600000).toISOString();
  const calendar = await request(`/api/calendar?brand_id=${branch.id}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  assert(calendar.some(item => item.id === post.id), 'Calendar did not return the post');

  const metaConfig = await request('/api/meta/config');
  assert(typeof metaConfig.configured === 'boolean', 'Meta config endpoint failed');

  console.log('SMOKE TEST PASS');
  console.log('Checked: health, login/session, multi-brand, branch, templates, Facebook demo publish, Instagram demo publish, scheduler, calendar, Meta config.');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(resolve, 1500);
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
