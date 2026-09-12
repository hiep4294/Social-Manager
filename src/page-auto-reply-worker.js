import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { decryptSecret } from './security.js';
import { classifyPageCommentRisk, commentOnFacebookObject, draftSafePageReply, listPagePostsWithComments } from './facebook-page-engagement.js';

const enabled = String(process.env.PAGE_AUTO_REPLY_ENABLED || '').toLowerCase() === 'true';

if (!enabled) {
  console.log('Page auto reply: disabled');
} else {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, '..');
  const dbPath = process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db');
  const statusPath = path.join(root, 'public', 'page-auto-reply-status.json');
  const pollMs = Math.max(30_000, Number(process.env.PAGE_AUTO_REPLY_POLL_MS || 60_000));
  const mode = String(process.env.PAGE_AUTO_REPLY_MODE || 'safe').toLowerCase();

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS community_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL,
      social_account_id INTEGER NOT NULL,
      page_id TEXT NOT NULL,
      post_id TEXT,
      external_comment_id TEXT NOT NULL UNIQUE,
      author_id TEXT,
      author_name TEXT,
      message TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT 'LOW',
      suggested_reply TEXT,
      status TEXT NOT NULL DEFAULT 'NEW',
      reply_external_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_community_inbox_status ON community_inbox(status, risk, created_at);
  `);

  const nowIso = () => new Date().toISOString();
  let running = false;

  function writeStatus(payload) {
    const waiting = db.prepare("SELECT COUNT(*) AS n FROM community_inbox WHERE status IN ('NEW','NEEDS_REVIEW')").get()?.n || 0;
    const replied = db.prepare("SELECT COUNT(*) AS n FROM community_inbox WHERE status='REPLIED'").get()?.n || 0;
    const failed = db.prepare("SELECT COUNT(*) AS n FROM community_inbox WHERE status='FAILED'").get()?.n || 0;
    try {
      fs.writeFileSync(statusPath, JSON.stringify({
        enabled: true,
        mode,
        queue: { waiting, replied, failed },
        ...payload,
        updated_at: nowIso()
      }, null, 2), 'utf8');
    } catch {}
  }

  async function scanAccount(account) {
    const brand = db.prepare('SELECT * FROM brands WHERE id=?').get(account.brand_id) || {};
    const accessToken = decryptSecret(account.access_token_enc);
    const data = await listPagePostsWithComments({
      pageId: account.account_id,
      accessToken,
      postLimit: Number(process.env.PAGE_AUTO_REPLY_POST_LIMIT || 12),
      commentLimit: Number(process.env.PAGE_AUTO_REPLY_COMMENT_LIMIT || 50)
    });

    let discovered = 0;
    let autoReplied = 0;
    for (const post of data?.data || []) {
      for (const comment of post?.comments?.data || []) {
        const commentId = String(comment?.id || '').trim();
        if (!commentId) continue;
        const authorId = String(comment?.from?.id || '').trim();
        if (authorId && authorId === String(account.account_id)) continue;
        if (db.prepare('SELECT 1 FROM community_inbox WHERE external_comment_id=?').get(commentId)) continue;

        const message = String(comment?.message || '');
        const risk = classifyPageCommentRisk(message);
        const suggestedReply = draftSafePageReply(message, brand);
        const now = nowIso();
        db.prepare(`
          INSERT INTO community_inbox(
            brand_id,social_account_id,page_id,post_id,external_comment_id,author_id,author_name,
            message,risk,suggested_reply,status,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          account.brand_id,
          account.id,
          String(account.account_id),
          String(post?.id || ''),
          commentId,
          authorId || null,
          String(comment?.from?.name || ''),
          message,
          risk,
          suggestedReply,
          risk === 'LOW' && mode === 'safe' ? 'AUTO_REPLY_PENDING' : 'NEEDS_REVIEW',
          now,
          now
        );
        discovered += 1;

        if (risk === 'LOW' && mode === 'safe') {
          try {
            const result = await commentOnFacebookObject({ objectId: commentId, message: suggestedReply, accessToken });
            db.prepare(`
              UPDATE community_inbox
              SET status='REPLIED', reply_external_id=?, error=NULL, updated_at=?
              WHERE external_comment_id=?
            `).run(result?.id || null, nowIso(), commentId);
            autoReplied += 1;
          } catch (error) {
            db.prepare(`
              UPDATE community_inbox
              SET status='FAILED', error=?, updated_at=?
              WHERE external_comment_id=?
            `).run(String(error?.message || error), nowIso(), commentId);
          }
        }
      }
    }
    return { discovered, autoReplied };
  }

  async function scan() {
    if (running) return;
    running = true;
    const startedAt = nowIso();
    let discovered = 0;
    let autoReplied = 0;
    try {
      const accounts = db.prepare("SELECT * FROM social_accounts WHERE platform='facebook' ORDER BY id").all();
      for (const account of accounts) {
        try {
          const result = await scanAccount(account);
          discovered += result.discovered;
          autoReplied += result.autoReplied;
        } catch (error) {
          console.error(`Page auto reply: account=${account.id} error: ${String(error?.message || error)}`);
        }
      }
      writeStatus({ status: 'OK', started_at: startedAt, accounts: accounts.length, discovered, auto_replied: autoReplied });
    } catch (error) {
      writeStatus({ status: 'ERROR', error: String(error?.message || error), started_at: startedAt });
      console.error(`Page auto reply: ${String(error?.message || error)}`);
    } finally {
      running = false;
    }
  }

  setInterval(() => scan().catch(() => {}), pollMs);
  setTimeout(() => scan().catch(() => {}), 8_000);
  writeStatus({ status: 'STARTING', poll_ms: pollMs });
  console.log(`Page auto reply: enabled mode=${mode}, polling every ${pollMs}ms`);
}
