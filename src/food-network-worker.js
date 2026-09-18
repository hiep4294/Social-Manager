import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { enqueueOperatorJob, ensureOperatorSchema } from './facebook-operator-core.js';
import { findFacebookAsset } from './group-monitor-core.js';
import { foodPageBlueprints, plannedCreateDate, pickRecipeForPage, buildRecipePost, localDateInVietnam } from './food-network-core.js';

const enabled = String(process.env.FOOD_NETWORK_AUTO_ENABLED ?? 'true').toLowerCase() !== 'false';

function nowIso() { return new Date().toISOString(); }
function stripHtml(value = '') { return String(value).replace(/<[^>]*>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalized(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function localClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const m = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return Number(m.hour) * 60 + Number(m.minute);
}

async function licensedWikimediaImage(title) {
  const wanted = normalized(title).split(' ').filter(x => x.length >= 3);
  const queries = [`\"${title}\"`, title, `${title} món ăn`];
  for (const query of queries) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', '12');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|mime|extmetadata');
    url.searchParams.set('iiurlwidth', '1200');
    const response = await fetch(url, { headers: { 'User-Agent': 'Social-Manager-FoodNetwork/1.9' } });
    if (!response.ok) continue;
    const body = await response.json().catch(() => ({}));
    const pages = Object.values(body?.query?.pages || {}).sort((a, b) => Number(a.index || 999) - Number(b.index || 999));
    for (const item of pages) {
      const ii = item?.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|webp)$/i.test(String(ii.mime || ''))) continue;
      const meta = ii.extmetadata || {};
      const license = stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value || '');
      if (!/(CC0|CC BY|Public domain|Public Domain)/i.test(license)) continue;
      const hay = normalized(`${item.title || ''} ${meta.ImageDescription?.value || ''}`);
      const relevance = wanted.filter(token => hay.includes(token)).length;
      if (wanted.length && relevance === 0) continue;
      const imageUrl = ii.thumburl || ii.url;
      if (!imageUrl) continue;
      const artist = stripHtml(meta.Artist?.value || meta.Credit?.value || 'Wikimedia Commons').slice(0, 160);
      const sourceUrl = ii.descriptionurl || ii.descriptionshorturl || '';
      const attribution = /CC0|Public domain/i.test(license)
        ? `Ảnh minh họa: Wikimedia Commons (${license || 'Public domain'})`
        : `Ảnh minh họa: ${artist || 'tác giả trên Wikimedia Commons'} / Wikimedia Commons (${license})`;
      return { imageUrl, sourceUrl, license, artist, attribution };
    }
  }
  return null;
}

function ensureSchema(db) {
  ensureOperatorSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS food_network_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS food_network_pages (
      slot INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      theme TEXT NOT NULL,
      voice TEXT NOT NULL,
      planned_create_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      page_url TEXT,
      create_job_id TEXT,
      last_error TEXT,
      activated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS food_network_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      page_slot INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      recipe_title TEXT NOT NULL,
      content TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      image_url TEXT,
      image_source_url TEXT,
      image_attribution TEXT,
      post_job_id TEXT,
      status TEXT NOT NULL DEFAULT 'PLANNED',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(date,page_slot)
    );
    CREATE INDEX IF NOT EXISTS idx_food_pages_due ON food_network_pages(status, planned_create_at);
    CREATE INDEX IF NOT EXISTS idx_food_daily_status ON food_network_daily(status, date);
  `);
}

function getMeta(db, key) { return db.prepare('SELECT value FROM food_network_meta WHERE key=?').get(key)?.value || null; }
function setMeta(db, key, value) {
  db.prepare(`INSERT INTO food_network_meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, String(value), nowIso());
}

function seedPages(db) {
  let startAt = getMeta(db, 'start_at');
  if (!startAt) {
    startAt = String(process.env.FOOD_NETWORK_START_DATE || nowIso());
    setMeta(db, 'start_at', startAt);
  }
  const now = nowIso();
  const ins = db.prepare(`INSERT OR IGNORE INTO food_network_pages(slot,name,theme,voice,planned_create_at,status,created_at,updated_at) VALUES(?,?,?,?,?,'PLANNED',?,?)`);
  for (const page of foodPageBlueprints()) ins.run(page.slot, page.name, page.theme, page.voice, plannedCreateDate(startAt, page.slot), now, now);
}

function enqueueLocalPostPage(db, { id, pageName, pageUrl, message, imageUrl }) {
  const existing = db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(id);
  if (existing) return existing;
  const now = nowIso();
  db.prepare(`INSERT INTO facebook_operator_jobs(id,brand_id,action,payload_json,status,attempts,created_at,updated_at) VALUES(?,NULL,'post_page',?,'QUEUED',0,?,?)`)
    .run(id, JSON.stringify({ page_name: pageName, page_url: pageUrl, message, image_url: imageUrl }), now, now);
  return db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(id);
}

function pagePostMinute(slot) {
  const start = Math.max(0, Math.min(1439, Number(process.env.FOOD_NETWORK_POST_WINDOW_START_MINUTE || 660)));
  const width = Math.max(60, Math.min(720, Number(process.env.FOOD_NETWORK_POST_WINDOW_MINUTES || 540)));
  return Math.min(1439, start + (((Number(slot) - 1) * 37) % width));
}

function syncCreateResults(db) {
  const rows = db.prepare("SELECT * FROM food_network_pages WHERE status IN ('CREATE_QUEUED','WAITING_USER','NEEDS_REVIEW') AND create_job_id IS NOT NULL").all();
  for (const row of rows) {
    const job = db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(row.create_job_id);
    if (!job) continue;
    if (job.status === 'DONE') {
      let result = {};
      try { result = JSON.parse(job.result_json || '{}'); } catch {}
      const asset = findFacebookAsset(db, { assetType: 'PAGE', name: row.name });
      const pageUrl = asset?.url || result.url || null;
      if (!pageUrl || /\/pages\/create/i.test(pageUrl)) {
        db.prepare("UPDATE food_network_pages SET status='NEEDS_REVIEW',last_error=?,updated_at=? WHERE slot=?").run('Không xác định được URL Page sau khi tạo', nowIso(), row.slot);
      } else {
        db.prepare("UPDATE food_network_pages SET status='ACTIVE',page_url=?,last_error=NULL,activated_at=COALESCE(activated_at,?),updated_at=? WHERE slot=?").run(pageUrl, nowIso(), nowIso(), row.slot);
      }
    } else if (['WAITING_USER','NEEDS_REVIEW','FAILED'].includes(job.status)) {
      db.prepare('UPDATE food_network_pages SET status=?,last_error=?,updated_at=? WHERE slot=?').run(job.status, job.error || job.status, nowIso(), row.slot);
    }
  }
}

function queueDuePages(db) {
  const createEnabled = String(process.env.FOOD_NETWORK_CREATE_PAGES_ENABLED ?? 'false').toLowerCase() === 'true';
  if (!createEnabled) return;
  const due = db.prepare("SELECT * FROM food_network_pages WHERE status='PLANNED' AND planned_create_at<=? ORDER BY slot LIMIT 1").get(nowIso());
  if (!due) return;
  const jobId = `food-create-page-${String(due.slot).padStart(2,'0')}`;
  const job = enqueueOperatorJob(db, {
    id: jobId,
    action: 'create_page',
    payload: { name: due.name, category: process.env.FOOD_NETWORK_PAGE_CATEGORY || 'Food & beverage', bio: `${due.theme}. Công thức nấu ăn dễ làm mỗi ngày.` }
  });
  db.prepare("UPDATE food_network_pages SET status='CREATE_QUEUED',create_job_id=?,last_error=NULL,updated_at=? WHERE slot=?").run(job.id, nowIso(), due.slot);
  console.log(`Food Network: queued Page ${due.slot}/24 - ${due.name}`);
}

function syncPostResults(db) {
  const rows = db.prepare("SELECT * FROM food_network_daily WHERE status IN ('POST_QUEUED','WAITING_USER','NEEDS_REVIEW') AND post_job_id IS NOT NULL").all();
  for (const row of rows) {
    const job = db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(row.post_job_id);
    if (!job) continue;
    if (job.status === 'DONE') {
      db.prepare("UPDATE food_network_daily SET status='DONE',error=NULL,updated_at=? WHERE id=?").run(nowIso(), row.id);
    } else if (['WAITING_USER','NEEDS_REVIEW','FAILED'].includes(job.status)) {
      db.prepare('UPDATE food_network_daily SET status=?,error=?,updated_at=? WHERE id=?').run(job.status, job.error || job.status, nowIso(), row.id);
      if (['WAITING_USER','NEEDS_REVIEW'].includes(job.status)) {
        db.prepare('UPDATE food_network_pages SET status=?,last_error=?,updated_at=? WHERE slot=?').run(job.status, job.error || job.status, nowIso(), row.page_slot);
      }
    }
  }
}

async function planAndQueueDaily(db) {
  const date = localDateInVietnam();
  const nowMinutes = localClock();
  const pages = db.prepare("SELECT * FROM food_network_pages WHERE status='ACTIVE' ORDER BY slot").all();
  let imageLookups = 0;
  for (const page of pages) {
    if (nowMinutes < pagePostMinute(page.slot)) continue;
    let daily = db.prepare('SELECT * FROM food_network_daily WHERE date=? AND page_slot=?').get(date, page.slot);
    if (!daily) {
      const used = db.prepare('SELECT recipe_id FROM food_network_daily WHERE date=?').all(date).map(x => x.recipe_id);
      const recipe = pickRecipeForPage({ pageSlot: page.slot, date, usedRecipeIds: used });
      const rendered = buildRecipePost({ page, recipe });
      const now = nowIso();
      db.prepare(`INSERT INTO food_network_daily(date,page_slot,recipe_id,recipe_title,content,image_prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'WAITING_IMAGE',?,?)`)
        .run(date, page.slot, recipe.id, recipe.title, rendered.content, rendered.imagePrompt, now, now);
      daily = db.prepare('SELECT * FROM food_network_daily WHERE date=? AND page_slot=?').get(date, page.slot);
    }
    if (daily.status === 'WAITING_IMAGE' && imageLookups < 2 && (!daily.next_retry_at || daily.next_retry_at <= nowIso())) {
      imageLookups += 1;
      const image = await licensedWikimediaImage(daily.recipe_title).catch(() => null);
      if (!image) {
        const next = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        db.prepare("UPDATE food_network_daily SET attempts=attempts+1,next_retry_at=?,error='Chưa tìm thấy ảnh món ăn có giấy phép phù hợp',updated_at=? WHERE id=?").run(next, nowIso(), daily.id);
        continue;
      }
      const message = `${daily.content}\n\n${image.attribution}`;
      const jobId = `food-post-${date}-${String(page.slot).padStart(2,'0')}`;
      enqueueLocalPostPage(db, { id: jobId, pageName: page.name, pageUrl: page.page_url, message, imageUrl: image.imageUrl });
      db.prepare("UPDATE food_network_daily SET image_url=?,image_source_url=?,image_attribution=?,post_job_id=?,status='POST_QUEUED',error=NULL,updated_at=? WHERE id=?")
        .run(image.imageUrl, image.sourceUrl || null, image.attribution, jobId, nowIso(), daily.id);
      console.log(`Food Network: queued daily post Page ${page.slot} - ${daily.recipe_title}`);
    }
  }
}

function writeStatus(db, statusPath) {
  const pageCounts = Object.fromEntries(db.prepare('SELECT status,COUNT(*) n FROM food_network_pages GROUP BY status').all().map(x => [x.status, Number(x.n)]));
  const today = localDateInVietnam();
  const postCounts = Object.fromEntries(db.prepare('SELECT status,COUNT(*) n FROM food_network_daily WHERE date=? GROUP BY status').all(today).map(x => [x.status, Number(x.n)]));
  const nextPage = db.prepare("SELECT slot,name,planned_create_at,status FROM food_network_pages WHERE status='PLANNED' ORDER BY planned_create_at LIMIT 1").get() || null;
  const activePages = db.prepare("SELECT slot,name,page_url,status FROM food_network_pages WHERE status='ACTIVE' ORDER BY slot").all();
  const createPagesEnabled = String(process.env.FOOD_NETWORK_CREATE_PAGES_ENABLED ?? 'false').toLowerCase() === 'true';
  try {
    fs.writeFileSync(statusPath, JSON.stringify({
      enabled: true,
      mode: 'AUTO',
      date: today,
      pages: pageCounts,
      today_posts: postCounts,
      active_pages: activePages,
      create_pages_enabled: createPagesEnabled,
      next_page: createPagesEnabled ? nextPage : null,
      image_provider: 'Wikimedia Commons licensed media',
      updated_at: nowIso()
    }, null, 2), 'utf8');
  } catch {}
}

if (!enabled) {
  console.log('Food Network auto worker: disabled');
} else {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'data');
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });
  const db = new Database(process.env.SOCIAL_MANAGER_DB || path.join(dataDir, 'social-manager.db'));
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  seedPages(db);
  const statusPath = path.join(publicDir, 'food-network-status.json');
  const tickMs = Math.max(30_000, Number(process.env.FOOD_NETWORK_TICK_MS || 60_000));
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      syncCreateResults(db);
      queueDuePages(db);
      syncPostResults(db);
      await planAndQueueDaily(db);
      writeStatus(db, statusPath);
    } catch (error) {
      console.error(`Food Network auto worker: ${String(error?.message || error)}`);
    } finally { busy = false; }
  }
  setInterval(() => tick().catch(() => {}), tickMs);
  setTimeout(() => tick().catch(() => {}), 5000);
  console.log(`Food Network auto worker: ON pages=24 cadence=2/month posts=1/day/page tick=${tickMs}ms`);
}
