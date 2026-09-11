import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'social-manager-mcp-test-'));
const dbPath = path.join(tempRoot, 'social-manager.db');
const mcpPort = 33000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${mcpPort}`;
const token = 'test-mcp-token-123456789';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseTool(result) {
  const block = result?.content?.find(item => item.type === 'text');
  if (!block?.text) throw new Error('MCP tool did not return text content');
  return JSON.parse(block.text);
}

const fixture = new Database(dbPath);
fixture.exec(`
CREATE TABLE brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'BRAND',
  parent_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  slogan TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  opening_hours TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER,
  content TEXT NOT NULL,
  image_path TEXT,
  image_url TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE post_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  external_id TEXT,
  error TEXT,
  published_at TEXT,
  locked_at TEXT,
  UNIQUE(post_id, platform)
);
`);
const now = new Date().toISOString();
fixture.prepare(`
  INSERT INTO brands(kind,parent_id,name,address,phone,active,created_at,updated_at)
  VALUES('BRAND',NULL,'MCP Test Brand','Ha Noi','0000000000',1,?,?)
`).run(now, now);
fixture.close();

const child = spawn(process.execPath, ['src/mcp-server.js'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    MCP_PORT: String(mcpPort),
    MCP_HOST: '127.0.0.1',
    MCP_API_TOKEN: token,
    MCP_ALLOW_UNAUTHENTICATED: 'false',
    SOCIAL_MANAGER_DB: dbPath,
    DEMO_MODE: 'true',
    FACEBOOK_PAGE_ID: 'facebook-test-page-001',
    FACEBOOK_PAGE_ACCESS_TOKEN: 'facebook-test-token',
    META_GRAPH_VERSION: 'v23.0'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`MCP server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`MCP server did not become ready:\n${serverOutput}`);
}

let client;
try {
  await waitForServer();

  const unauthorized = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} })
  });
  assert(unauthorized.status === 401, `Expected MCP auth 401, got ${unauthorized.status}`);

  client = new Client(
    { name: 'social-manager-ci-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } }
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name);
  for (const required of ['list_brands', 'list_facebook_accounts', 'post_to_facebook', 'get_post_status']) {
    assert(names.includes(required), `Missing MCP tool: ${required}`);
  }

  const brandsResult = await client.callTool({ name: 'list_brands', arguments: {} });
  assert(!brandsResult.isError, 'list_brands returned error');
  const brands = parseTool(brandsResult).brands;
  assert(brands.length === 1 && brands[0].name === 'MCP Test Brand', 'Unexpected brand list');

  const accountsResult = await client.callTool({ name: 'list_facebook_accounts', arguments: {} });
  assert(!accountsResult.isError, 'list_facebook_accounts returned error');
  const accounts = parseTool(accountsResult).accounts;
  assert(accounts[0].connected === true, 'Facebook fallback credential not detected');
  assert(accounts[0].page_id === 'facebook-test-page-001', 'Unexpected Facebook page id');

  const publishResult = await client.callTool({
    name: 'post_to_facebook',
    arguments: {
      brand_name: 'MCP Test Brand',
      content: 'xin chào',
      image_url: 'https://example.com/test.jpg'
    }
  });
  assert(!publishResult.isError, `post_to_facebook returned error: ${JSON.stringify(publishResult)}`);
  const published = parseTool(publishResult);
  assert(published.ok === true, 'Facebook post did not succeed');
  assert(published.status === 'PUBLISHED', 'Facebook post status is not PUBLISHED');
  assert(published.demo === true, 'Test must use DEMO_MODE');
  assert(String(published.facebook_post_id).startsWith('demo-facebook-'), 'Missing demo Facebook post id');

  const statusResult = await client.callTool({
    name: 'get_post_status',
    arguments: { local_post_id: published.local_post_id }
  });
  assert(!statusResult.isError, 'get_post_status returned error');
  const status = parseTool(statusResult).post;
  assert(status.status === 'PUBLISHED', 'Stored post status is not PUBLISHED');
  assert(status.content === 'xin chào', 'Stored post content mismatch');

  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduleResult = await client.callTool({
    name: 'post_to_facebook',
    arguments: {
      brand_id: brands[0].id,
      content: 'scheduled MCP test',
      scheduled_at: scheduledAt
    }
  });
  assert(!scheduleResult.isError, 'Scheduled Facebook tool returned error');
  const scheduled = parseTool(scheduleResult);
  assert(scheduled.action === 'scheduled' && scheduled.status === 'PENDING', 'Scheduled post was not queued');

  const verify = new Database(dbPath, { readonly: true });
  const count = verify.prepare("SELECT COUNT(*) AS n FROM post_targets WHERE platform='facebook'").get().n;
  const publishedCount = verify.prepare("SELECT COUNT(*) AS n FROM post_targets WHERE platform='facebook' AND status='PUBLISHED'").get().n;
  const pendingCount = verify.prepare("SELECT COUNT(*) AS n FROM post_targets WHERE platform='facebook' AND status='PENDING'").get().n;
  verify.close();
  assert(count === 2 && publishedCount === 1 && pendingCount === 1, 'Database state mismatch after MCP calls');

  console.log('MCP TEST PASS');
  console.log('Checked: bearer auth, MCP discovery, tool listing, brand lookup, Facebook account lookup, direct Facebook demo publish, status lookup, scheduling, SQLite persistence.');
} finally {
  if (client) await client.close().catch(() => {});
  child.kill('SIGTERM');
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(resolve, 1500);
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
