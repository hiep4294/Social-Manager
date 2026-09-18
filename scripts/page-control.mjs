import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enqueueOperatorJob, ensureOperatorSchema } from '../src/facebook-operator-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const db = new Database(process.env.SOCIAL_MANAGER_DB || path.join(root, 'data', 'social-manager.db'));
db.pragma('journal_mode = WAL');
ensureOperatorSchema(db);

const [modeRaw, pageUrlRaw] = process.argv.slice(2);
const mode = String(modeRaw || 'inspect').trim().toLowerCase();
const pageUrl = String(pageUrlRaw || '').trim();
if (!pageUrl) {
  console.error('Usage: node scripts/page-control.mjs <inspect|complete> <facebook-page-url>');
  process.exit(2);
}

const terminal = new Set(['DONE','FAILED','WAITING_USER','NEEDS_REVIEW']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runJob(action, payload, timeoutMs = 120000) {
  const id = `pagectl-${action}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  enqueueOperatorJob(db, { id, action, payload });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const row = db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(id);
    if (row && terminal.has(row.status)) {
      let result = {};
      try { result = JSON.parse(row.result_json || '{}'); } catch {}
      return { id, action, status: row.status, result, error: row.error || null };
    }
    await sleep(1200);
  }
  return { id, action, status: 'TIMEOUT', result: {}, error: 'Timeout chờ Operator xử lý job' };
}

function safeName(value) {
  return String(value || '').replace(/\s+/g,' ').trim().slice(0,100);
}

try {
  const inspect = await runJob('inspect_page', { page_url: pageUrl });
  if (mode === 'inspect' || inspect.status !== 'DONE') {
    console.log('PAGE_CONTROL_RESULT=' + JSON.stringify({ mode, inspect }));
    process.exit(inspect.status === 'DONE' ? 0 : 3);
  }

  const resolvedUrl = inspect.result.page_url || pageUrl;
  const pageName = safeName(inspect.result.page_name) || 'Bếp ngon mỗi ngày';
  const bio = `${pageName} – công thức dễ làm, món ngon mỗi ngày và mẹo bếp thực tế. Theo dõi trang để mỗi ngày có thêm một gợi ý cho bữa ăn.`;
  const intro = `Chào mừng bạn đến với ${pageName}!\n\nTrang chia sẻ công thức dễ làm, gợi ý món ăn mỗi ngày và những mẹo bếp thực tế. Theo dõi trang để không bỏ lỡ các món mới.\n\n#MonNgonMoiNgay #CongThucNauAn #BepNha`;

  const edit = await runJob('edit_page', {
    page_url: resolvedUrl,
    page_name: pageName,
    category: 'Food & beverage',
    bio
  });

  const post = await runJob('post_page', {
    page_url: resolvedUrl,
    page_name: pageName,
    message: intro
  });

  console.log('PAGE_CONTROL_RESULT=' + JSON.stringify({
    mode,
    page_name: pageName,
    page_url: resolvedUrl,
    inspect,
    edit,
    post
  }));
  process.exit(post.status === 'DONE' ? 0 : 4);
} finally {
  db.close();
}
