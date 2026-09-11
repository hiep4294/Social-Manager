import 'dotenv/config';
import { createServer as createHttpServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { decryptSecret } from './security.js';
import { publishFacebook } from './platforms/facebook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const MCP_PORT = Number(process.env.MCP_PORT || 3001);
const MCP_HOST = process.env.MCP_HOST || '0.0.0.0';
const MCP_API_TOKEN = String(process.env.MCP_API_TOKEN || '');
const MCP_ALLOW_UNAUTHENTICATED = process.env.MCP_ALLOW_UNAUTHENTICATED === 'true';

function nowIso() {
  return new Date().toISOString();
}

function tableExists(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function requireSchema() {
  for (const table of ['brands', 'posts', 'post_targets']) {
    if (!tableExists(table)) {
      throw new Error(`Database chưa được khởi tạo đầy đủ: thiếu bảng ${table}. Hãy chạy Social Manager trước.`);
    }
  }
}

function result(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

function activeBrands() {
  requireSchema();
  return db.prepare(`
    SELECT b.id,b.kind,b.parent_id,b.name,b.address,b.phone,p.name AS parent_name
    FROM brands b
    LEFT JOIN brands p ON p.id=b.parent_id
    WHERE b.active=1
    ORDER BY CASE b.kind WHEN 'BRAND' THEN 0 ELSE 1 END, COALESCE(p.name,b.name), b.name
  `).all();
}

function findBrand({ brandId, brandName } = {}) {
  const rows = activeBrands();

  if (brandId) {
    const row = rows.find(item => item.id === Number(brandId));
    if (!row) throw new Error(`Không tìm thấy thương hiệu/chi nhánh id=${brandId}`);
    return row;
  }

  if (brandName) {
    const wanted = String(brandName).trim().toLocaleLowerCase('vi');
    const exact = rows.filter(item => String(item.name).trim().toLocaleLowerCase('vi') === wanted);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(`Có nhiều mục cùng tên "${brandName}". Hãy dùng brand_id.`);

    const contains = rows.filter(item => String(item.name).toLocaleLowerCase('vi').includes(wanted));
    if (contains.length === 1) return contains[0];
    throw new Error(`Không xác định được thương hiệu/chi nhánh "${brandName}".`);
  }

  const connected = tableExists('social_accounts')
    ? db.prepare(`
        SELECT b.id,b.kind,b.parent_id,b.name,b.address,b.phone,p.name AS parent_name
        FROM brands b
        JOIN social_accounts s ON s.brand_id=b.id AND s.platform='facebook'
        LEFT JOIN brands p ON p.id=b.parent_id
        WHERE b.active=1
        ORDER BY b.id
      `).all()
    : [];

  if (connected.length === 1) return connected[0];
  if (connected.length > 1) {
    throw new Error(`Có ${connected.length} thương hiệu/chi nhánh đã kết nối Facebook. Hãy chỉ định brand_id hoặc brand_name.`);
  }

  if (rows.length === 1) return rows[0];
  throw new Error(`Có ${rows.length} thương hiệu/chi nhánh. Hãy chỉ định brand_id hoặc brand_name.`);
}

function facebookCredential(brandId) {
  if (tableExists('social_accounts')) {
    const account = db.prepare(`
      SELECT id,account_id,account_name,username,access_token_enc,updated_at
      FROM social_accounts
      WHERE brand_id=? AND platform='facebook'
    `).get(Number(brandId));

    if (account) {
      return {
        source: 'oauth',
        accountId: account.account_id,
        accountName: account.account_name,
        username: account.username,
        accessToken: decryptSecret(account.access_token_enc),
        updatedAt: account.updated_at
      };
    }
  }

  if (process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    return {
      source: 'env-fallback',
      accountId: process.env.FACEBOOK_PAGE_ID,
      accountName: 'Facebook Page',
      username: '',
      accessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      updatedAt: null
    };
  }

  return null;
}

function insertFacebookPost({ brandId, content, imageUrl, scheduledAt }) {
  const createdAt = nowIso();
  const transaction = db.transaction(() => {
    const postInfo = db.prepare(`
      INSERT INTO posts(brand_id,content,image_url,scheduled_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?)
    `).run(Number(brandId), content, imageUrl || null, scheduledAt || null, createdAt, createdAt);
    const postId = Number(postInfo.lastInsertRowid);
    const targetInfo = db.prepare(`
      INSERT INTO post_targets(post_id,platform,status)
      VALUES(?,'facebook','PENDING')
    `).run(postId);
    return { postId, targetId: Number(targetInfo.lastInsertRowid) };
  });
  return transaction();
}

async function createFacebookPost({ brandId, brandName, content, imageUrl, scheduledAt }) {
  const brand = findBrand({ brandId, brandName });
  const credential = facebookCredential(brand.id);
  if (!credential) {
    throw new Error(`${brand.name} chưa kết nối Facebook Page.`);
  }

  const message = String(content || '').trim();
  if (!message) throw new Error('Nội dung bài đăng đang trống.');

  let normalizedSchedule = null;
  if (scheduledAt) {
    const parsed = new Date(scheduledAt);
    if (Number.isNaN(parsed.getTime())) throw new Error('scheduled_at không hợp lệ. Hãy dùng ISO 8601.');
    normalizedSchedule = parsed.toISOString();
  }

  const { postId, targetId } = insertFacebookPost({
    brandId: brand.id,
    content: message,
    imageUrl: imageUrl || null,
    scheduledAt: normalizedSchedule
  });

  const shouldPublishNow = !normalizedSchedule || new Date(normalizedSchedule).getTime() <= Date.now();
  if (!shouldPublishNow) {
    return {
      ok: true,
      action: 'scheduled',
      local_post_id: postId,
      target_id: targetId,
      brand: { id: brand.id, name: brand.name },
      facebook_page: { id: credential.accountId, name: credential.accountName },
      scheduled_at: normalizedSchedule,
      status: 'PENDING'
    };
  }

  db.prepare(`UPDATE post_targets SET status='PROCESSING', locked_at=? WHERE id=?`).run(nowIso(), targetId);
  try {
    const published = await publishFacebook({
      message,
      imageUrl: imageUrl || null,
      pageId: credential.accountId,
      accessToken: credential.accessToken
    });
    const publishedAt = nowIso();
    const externalId = published?.id || published?.post_id || null;
    db.prepare(`
      UPDATE post_targets
      SET status='PUBLISHED',external_id=?,error=NULL,published_at=?,locked_at=NULL
      WHERE id=?
    `).run(externalId, publishedAt, targetId);

    return {
      ok: true,
      action: 'published',
      local_post_id: postId,
      target_id: targetId,
      brand: { id: brand.id, name: brand.name },
      facebook_page: { id: credential.accountId, name: credential.accountName },
      facebook_post_id: externalId,
      published_at: publishedAt,
      demo: published?.demo === true,
      status: 'PUBLISHED'
    };
  } catch (error) {
    const messageText = String(error?.message || error);
    db.prepare(`
      UPDATE post_targets SET status='FAILED',error=?,locked_at=NULL WHERE id=?
    `).run(messageText, targetId);
    return {
      ok: false,
      action: 'publish_failed',
      local_post_id: postId,
      target_id: targetId,
      brand: { id: brand.id, name: brand.name },
      error: messageText,
      status: 'FAILED'
    };
  }
}

export function buildSocialManagerMcpServer() {
  const server = new McpServer({ name: 'social-manager', version: '1.2.0' });

  server.registerTool(
    'list_brands',
    {
      description: 'Liệt kê các thương hiệu và chi nhánh đang hoạt động trong Social Manager để chọn đúng nơi đăng bài.',
      inputSchema: z.object({})
    },
    async () => result({ brands: activeBrands() })
  );

  server.registerTool(
    'list_facebook_accounts',
    {
      description: 'Liệt kê Facebook Page đã kết nối cho từng thương hiệu/chi nhánh. Không trả access token.',
      inputSchema: z.object({})
    },
    async () => {
      const brands = activeBrands();
      const accounts = brands.map(brand => {
        const credential = facebookCredential(brand.id);
        return {
          brand_id: brand.id,
          brand_name: brand.name,
          connected: Boolean(credential),
          page_id: credential?.accountId || null,
          page_name: credential?.accountName || null,
          source: credential?.source || null
        };
      });
      return result({ accounts });
    }
  );

  server.registerTool(
    'post_to_facebook',
    {
      description: 'Đăng ngay hoặc hẹn lịch một bài lên Facebook Page đã kết nối trong Social Manager. Đây là thao tác tạo nội dung công khai trên Facebook.',
      inputSchema: z.object({
        brand_id: z.number().int().positive().optional(),
        brand_name: z.string().min(1).optional(),
        content: z.string().min(1).max(50000),
        image_url: z.string().url().optional(),
        scheduled_at: z.string().optional()
      })
    },
    async input => {
      try {
        const output = await createFacebookPost({
          brandId: input.brand_id,
          brandName: input.brand_name,
          content: input.content,
          imageUrl: input.image_url,
          scheduledAt: input.scheduled_at
        });
        return result(output, output.ok === false);
      } catch (error) {
        return result({ ok: false, error: String(error?.message || error) }, true);
      }
    }
  );

  server.registerTool(
    'get_post_status',
    {
      description: 'Kiểm tra trạng thái một bài Facebook đã tạo qua Social Manager bằng local_post_id.',
      inputSchema: z.object({ local_post_id: z.number().int().positive() })
    },
    async ({ local_post_id: postId }) => {
      requireSchema();
      const row = db.prepare(`
        SELECT p.id,p.brand_id,p.content,p.image_url,p.scheduled_at,p.created_at,
               pt.id AS target_id,pt.status,pt.external_id,pt.error,pt.published_at,
               b.name AS brand_name
        FROM posts p
        JOIN post_targets pt ON pt.post_id=p.id AND pt.platform='facebook'
        LEFT JOIN brands b ON b.id=p.brand_id
        WHERE p.id=?
      `).get(Number(postId));
      if (!row) return result({ ok: false, error: `Không tìm thấy bài ${postId}` }, true);
      return result({ ok: true, post: row });
    }
  );

  return server;
}

const handler = createMcpHandler(() => buildSocialManagerMcpServer());
const nodeHandler = toNodeHandler(handler);

function authorized(req) {
  if (MCP_ALLOW_UNAUTHENTICATED) return true;
  if (!MCP_API_TOKEN) return false;
  return req.headers.authorization === `Bearer ${MCP_API_TOKEN}`;
}

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'social-manager-mcp',
      version: '1.2.0',
      auth_configured: MCP_ALLOW_UNAUTHENTICATED || Boolean(MCP_API_TOKEN),
      database: path.basename(dbPath)
    }));
    return;
  }

  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    return;
  }

  if (!authorized(req)) {
    if (!MCP_API_TOKEN && !MCP_ALLOW_UNAUTHENTICATED) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'MCP_API_TOKEN_NOT_CONFIGURED' }));
      return;
    }
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="social-manager-mcp"'
    });
    res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
    return;
  }

  try {
    await nodeHandler(req, res);
  } catch (error) {
    console.error('MCP request failed:', error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'MCP_INTERNAL_ERROR' }));
  }
});

httpServer.listen(MCP_PORT, MCP_HOST, () => {
  console.log(`Social Manager MCP listening on http://${MCP_HOST}:${MCP_PORT}/mcp`);
});
