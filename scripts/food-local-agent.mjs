import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {
  buildRecipePost,
  foodRecipes,
  pickRecipeForPage
} from '../src/food-network-core.js';
import {
  enqueueOperatorJob,
  ensureOperatorSchema
} from '../src/facebook-operator-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'food-local-pages.json');
const DB_PATH = process.env.SOCIAL_MANAGER_DB || path.join(REPO_ROOT, 'data', 'social-manager.db');

function defaultFoodImageRoot() {
  const base = process.env.OneDrive
    ? path.join(process.env.OneDrive, 'Documents')
    : path.join(process.env.USERPROFILE || os.homedir(), 'Documents');
  return path.join(base, 'anh-mon-an');
}

const IMAGE_ROOT = path.resolve(process.env.FOOD_IMAGE_ROOT || defaultFoodImageRoot());
const DOWNLOAD_ROOT = path.resolve(
  process.env.FOOD_DOWNLOAD_ROOT ||
  path.join(process.env.USERPROFILE || os.homedir(), 'Downloads')
);

const SYSTEM_ROOT = path.join(IMAGE_ROOT, '_system');
const JOB_ROOT = path.join(SYSTEM_ROOT, 'jobs');
const LOG_ROOT = path.join(SYSTEM_ROOT, 'logs');
const FAILED_ROOT = path.join(SYSTEM_ROOT, 'failed');
const TEMP_ROOT = path.join(SYSTEM_ROOT, 'temp');
const STATE_ROOT = path.join(SYSTEM_ROOT, 'state');
const LOGO_ROOT = path.join(SYSTEM_ROOT, 'logos');
const CHATGPT_POSTER_LAYOUT = 'chatgpt-food-poster-v3';

for (const dir of [IMAGE_ROOT, SYSTEM_ROOT, JOB_ROOT, LOG_ROOT, FAILED_ROOT, TEMP_ROOT, STATE_ROOT, LOGO_ROOT]) {
  fs.mkdirSync(dir, { recursive:true });
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive:true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
ensureOperatorSchema(db);

function nowIso() {
  return new Date().toISOString();
}

function vnParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Ho_Chi_Minh',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    second:'2-digit',
    hourCycle:'h23'
  }).formatToParts(now);
  return Object.fromEntries(parts.map(x => [x.type, x.value]));
}

function vnDate(now = new Date()) {
  const p = vnParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

function selectedHour(page, date) {
  const hours = Array.isArray(config.schedule?.hours_vn) && config.schedule.hours_vn.length
    ? config.schedule.hours_vn.map(Number).filter(Number.isFinite)
    : [8,9,10,11,12,13];
  const digest = crypto
    .createHash('sha256')
    .update(`${date}:${page.page_id}:daily-window-v1`)
    .digest();
  return hours[digest[0] % hours.length];
}

function dueInfo(page, now = new Date()) {
  const date = vnDate(now);
  const hour = selectedHour(page, date);
  const hh = String(hour).padStart(2, '0');
  const scheduledMs = Date.parse(`${date}T${hh}:00:00+07:00`);
  const catchUpHours = Math.max(0, Number(config.schedule?.catch_up_hours || 6));
  const deadlineMs = scheduledMs + catchUpHours * 60 * 60 * 1000;
  const nowMs = now.getTime();
  return {
    date,
    hour,
    scheduled_at:new Date(scheduledMs).toISOString(),
    deadline_at:new Date(deadlineMs).toISOString(),
    before:nowMs < scheduledMs,
    due:nowMs >= scheduledMs && nowMs <= deadlineMs,
    late:nowMs > deadlineMs
  };
}

function log(event, detail = {}) {
  const line = JSON.stringify({ at:nowIso(), event, ...detail });
  const file = path.join(LOG_ROOT, `agent-${vnDate()}.log`);
  fs.appendFileSync(file, line + '\n', 'utf8');
  console.log(`FOOD_AGENT_EVENT=${line}`);
}

function safeJsonRead(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}

function slug(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function recipeCode(recipeId) {
  return `RID${String(Number(recipeId)).padStart(3, '0')}`;
}

function mealPaths(recipe) {
  const code = recipeCode(recipe.id);
  const dir = path.join(IMAGE_ROOT, `${code}-${slug(recipe.title)}`);
  return {
    code,
    dir,
    source:path.join(dir, 'source.png'),
    meta:path.join(dir, 'meta.json'),
    finalDir:path.join(dir, 'final')
  };
}

function statePath(page) {
  return path.join(STATE_ROOT, `${page.page_key}.json`);
}

function catalogState(page) {
  return {
    version:1,
    page_id:String(page.page_id),
    page_name:page.page_name,
    last_post_date:null,
    last_post_ref:null,
    updated_at:null,
    recipes:foodRecipes().map(r => ({
      id:r.id,
      title:r.title,
      category:r.category,
      used:false,
      posted_date:null,
      posted_at:null,
      post_ref:null
    }))
  };
}

function mergeRecipeState(base, prior) {
  const old = new Map((prior?.recipes || []).map(x => [Number(x.id), x]));
  base.recipes = base.recipes.map(r => {
    const p = old.get(Number(r.id)) || {};
    return {
      ...r,
      used:Boolean(p.used),
      posted_date:p.posted_date || null,
      posted_at:p.posted_at || null,
      post_ref:p.post_ref || p.facebook_post_id || null
    };
  });
  base.last_post_date = prior?.last_post_date || null;
  base.last_post_ref = prior?.last_post_ref || prior?.last_post_id || null;
  return base;
}

function loadState(page) {
  const local = safeJsonRead(statePath(page));
  if (local) return mergeRecipeState(catalogState(page), local);

  const legacy = safeJsonRead(path.join(REPO_ROOT, 'content', `${page.page_key}-recipe-state.json`));
  const seeded = legacy ? mergeRecipeState(catalogState(page), legacy) : catalogState(page);
  saveState(page, seeded);
  return seeded;
}

function saveState(page, state) {
  state.updated_at = nowIso();
  writeJsonAtomic(statePath(page), state);
}

function jobPath(page, date) {
  return path.join(JOB_ROOT, `${date}-${page.page_key}.json`);
}

function loadJob(page, date) {
  return safeJsonRead(jobPath(page, date));
}

function saveJob(page, date, job) {
  job.updated_at = nowIso();
  writeJsonAtomic(jobPath(page, date), job);
}

function usedIds(state) {
  return (state.recipes || []).filter(x => x.used).map(x => Number(x.id));
}

function chooseRecipe(page, state, date) {
  return pickRecipeForPage({
    pageSlot:Number(page.page_slot),
    date,
    usedRecipeIds:usedIds(state)
  });
}

function buildImageSubtitle(recipe) {
  const byCategory = {
    gia_dinh:'Đậm vị, dễ ăn, hợp bữa cơm gia đình',
    mon_nuoc:'Ấm bụng, dễ ăn, hợp cho cả gia đình',
    mon_soi:'Nhanh gọn, đậm vị, dễ làm tại nhà',
    chay:'Thanh nhẹ, dễ ăn, ngon mà không ngán',
    hai_san:'Tươi ngon, đậm vị, hấp dẫn tại nhà',
    chien:'Vàng giòn, thơm ngon, dễ làm tại nhà',
    an_vat:'Ăn vui, dễ làm, hợp cho buổi xế',
    nuong:'Thơm nức, đậm vị, hợp dịp cuối tuần',
    banh:'Dễ làm tại nhà, thơm ngon và đẹp mắt',
    trang_mieng:'Ngọt dịu, dễ làm, dùng lạnh càng ngon',
    do_uong:'Tươi mát, dễ uống, làm nhanh tại nhà',
    rau_cu:'Tươi ngon, cân bằng, hợp bữa ăn hằng ngày'
  };
  return byCategory[recipe.category] || 'Ngon dễ làm, hợp cho bữa ăn hằng ngày';
}

function buildImagePrompt(page, recipe) {
  const ingredients = (recipe.ingredients || []).slice(0, 5).join(', ');
  const pageTitle = String(page.page_name || 'Hôm Nay Ăn Gì?').trim();
  const subtitle = buildImageSubtitle(recipe);

  return [
    'Tạo một ảnh vuông 1:1 chất lượng cao để đăng Facebook, phong cách food poster hiện đại và bắt mắt.',
    `Chủ đề chính là món Việt Nam "${recipe.title}".`,
    ingredients ? `Nguyên liệu nhận diện chính: ${ingredients}.` : '',
    '',
    'BỐ CỤC BẮT BUỘC:',
    `- Phần trên cùng có tiêu đề lớn tiếng Việt chính xác: "${pageTitle}".`,
    `- Ngay bên dưới có tên món nổi bật, viết chính xác: "${recipe.title}".`,
    `- Có một dòng mô tả ngắn, viết chính xác: "${subtitle}".`,
    '- Món ăn hoàn chỉnh chiếm phần lớn nửa dưới ảnh, nhìn ngon, nóng hổi và chân thực.',
    '- Có thể dùng các mảng brush-stroke, bảng màu nâu ấm, vàng, kem và xanh lá giống poster ẩm thực hiện đại.',
    '- Typography tiếng Việt phải rõ ràng, đúng dấu, dễ đọc trên điện thoại.',
    '',
    'PHONG CÁCH HÌNH ẢNH:',
    '- Food photography chân thực, ánh sáng ấm tự nhiên, góc chụp khoảng 45 độ.',
    '- Màu thực phẩm tự nhiên, món ăn rõ nét, bố cục sạch, không rối.',
    '- Có thể thêm rau hoặc nguyên liệu phụ phù hợp để ảnh cân đối nhưng không làm sai đặc trưng món.',
    '- Không người, không bàn tay, không watermark, không logo thương hiệu, không thêm chữ ngoài 3 dòng đã yêu cầu.',
    '- Không sai chính tả tiếng Việt; không đổi tên món; không tự thêm giá, số điện thoại hay thông tin quảng cáo.',
    '',
    'Mục tiêu: ảnh phải trông như một bài post Facebook hoàn chỉnh, có thể dùng ngay để đăng mà không cần ghép thêm tiêu đề.'
  ].filter(Boolean).join('\n');
}

function buildCaption(page, recipe) {
  const rendered = buildRecipePost({ page:{
    slot:Number(page.page_slot),
    name:page.page_name,
    theme:'',
    voice:'rõ bước, dễ theo'
  }, recipe });
  return `${rendered.content}\n\n${page.hashtag} #${recipeCode(recipe.id)}`;
}

function createDailyJob(page, date, due, recipe) {
  return {
    version:1,
    id:`food-${date}-${page.page_key}-${recipeCode(recipe.id)}`,
    date,
    page:{
      id:String(page.page_id),
      key:page.page_key,
      name:page.page_name
    },
    recipe:{
      id:Number(recipe.id),
      code:recipeCode(recipe.id),
      title:recipe.title
    },
    scheduled_at:due.scheduled_at,
    deadline_at:due.deadline_at,
    status:'SCHEDULED',
    image_attempts:0,
    image_job_id:null,
    post_job_id:null,
    final_path:null,
    created_at:nowIso(),
    updated_at:nowIso()
  };
}

function getOperatorJob(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM facebook_operator_jobs WHERE id=?').get(String(id)) || null;
}

function operatorResult(row) {
  try { return JSON.parse(row?.result_json || '{}'); }
  catch { return {}; }
}

function markStaleImageJob(row) {
  if (!row || row.status !== 'PROCESSING' || !row.locked_at) return row;
  const timeoutMinutes = Math.max(5, Number(config.image_generation?.job_timeout_minutes || 15));
  const age = Date.now() - Date.parse(row.locked_at);
  if (!Number.isFinite(age) || age <= timeoutMinutes * 60 * 1000) return row;
  db.prepare(`
    UPDATE facebook_operator_jobs
    SET status='FAILED',error='IMAGE_JOB_TIMEOUT',locked_at=NULL,updated_at=?
    WHERE id=? AND status='PROCESSING'
  `).run(nowIso(), row.id);
  return getOperatorJob(row.id);
}

async function importDownloadedImage(downloadPath, recipe) {
  const raw = path.resolve(String(downloadPath || ''));
  const relative = path.relative(DOWNLOAD_ROOT, raw);
  if (!raw || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Ảnh tải xuống nằm ngoài thư mục Downloads cho phép');
  }
  if (!fs.existsSync(raw) || !fs.statSync(raw).isFile()) {
    throw new Error('Không tìm thấy file ảnh ChatGPT đã tải');
  }

  const minBytes = Math.max(1000, Number(config.image_generation?.min_source_bytes || 10000));
  if (fs.statSync(raw).size < minBytes) throw new Error('File ảnh ChatGPT quá nhỏ');

  const info = await sharp(raw).metadata();
  if (!info.width || !info.height || info.width < 512 || info.height < 512) {
    throw new Error('Kích thước ảnh ChatGPT không đạt tối thiểu 512x512');
  }

  const p = mealPaths(recipe);
  fs.mkdirSync(p.dir, { recursive:true });
  await sharp(raw).rotate().png({ compressionLevel:9 }).toFile(p.source);

  const bytes = fs.readFileSync(p.source);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const meta = safeJsonRead(p.meta, {}) || {};
  meta.version = 1;
  meta.recipe_id = Number(recipe.id);
  meta.recipe_code = p.code;
  meta.recipe_title = recipe.title;
  meta.source = {
    path:p.source,
    sha256,
    bytes:bytes.length,
    width:info.width,
    height:info.height,
    layout:CHATGPT_POSTER_LAYOUT,
    imported_at:nowIso()
  };
  meta.final = meta.final || {};
  writeJsonAtomic(p.meta, meta);

  return { ...p, sha256, bytes:bytes.length };
}

function xml(value = '') {
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&apos;");
}

function wrapWords(text, maxChars) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function brandOverlay(page, recipe) {
  const brand = page.brand || {};
  const titleLines = wrapWords(String(recipe.title || '').toUpperCase(), 18);
  const titleSvg = titleLines.map((line, i) =>
    `<text x="80" y="${760 + i * 82}" font-size="66" font-weight="900" fill="#fffaf0" font-family="Arial,Segoe UI,sans-serif">${xml(line)}</text>`
  ).join('');

  return Buffer.from(`<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#3b1e0d" stop-opacity=".78"/>
      </linearGradient>
    </defs>
    <rect x="0" y="520" width="1080" height="560" fill="url(#fade)"/>
    <g transform="translate(68,64)">
      <circle cx="112" cy="112" r="108" fill="#fffaf0" stroke="#6d3b18" stroke-width="10"/>
      <text x="112" y="90" text-anchor="middle" font-size="38" font-weight="900" fill="#4b2712" font-family="Arial,Segoe UI,sans-serif">${xml(brand.line_1 || '')}</text>
      <text x="112" y="140" text-anchor="middle" font-size="46" font-weight="900" fill="#4b2712" font-family="Arial,Segoe UI,sans-serif">${xml(brand.line_2 || '')}</text>
      <text x="112" y="174" text-anchor="middle" font-size="17" font-weight="700" fill="#8c4f24" font-family="Arial,Segoe UI,sans-serif">${xml(brand.subtitle || '')}</text>
    </g>
    ${titleSvg}
    <text x="82" y="1015" font-size="27" font-weight="700" fill="#f9e4c5" font-family="Arial,Segoe UI,sans-serif">Công thức dễ làm • Mẹo bếp thực tế</text>
  </svg>`);
}

async function composeFinal(page, recipe) {
  const p = mealPaths(recipe);

  if (!fs.existsSync(p.source)) {
    throw new Error('Thiếu source.png từ ChatGPT');
  }

  fs.mkdirSync(p.finalDir, { recursive:true });

  const finalPath = path.join(
    p.finalDir,
    `${page.page_key}.jpg`
  );

  // ChatGPT now creates the complete poster including Page title,
  // recipe title and subtitle. Only normalize to Facebook-ready
  // 1080x1080; do not add a second title/logo layer.
  await sharp(p.source)
    .rotate()
    .resize(1080, 1080, {
      fit:'cover',
      position:'centre'
    })
    .jpeg({
      quality:94,
      chromaSubsampling:'4:4:4'
    })
    .toFile(finalPath);

  const finalMeta = await sharp(finalPath).metadata();

  if (
    finalMeta.width !== 1080 ||
    finalMeta.height !== 1080
  ) {
    throw new Error(
      `FINAL_IMAGE_DIMENSION_INVALID:${page.page_key}`
    );
  }

  const meta = safeJsonRead(p.meta, {}) || {};
  meta.final = meta.final || {};

  meta.final[page.page_key] = {
    path:finalPath,
    bytes:fs.statSync(finalPath).size,
    width:finalMeta.width,
    height:finalMeta.height,
    layout:CHATGPT_POSTER_LAYOUT,
    source:'chatgpt_generated_complete_poster',
    text:{
      page_title:String(page.page_name || ''),
      recipe_title:String(recipe.title || ''),
      subtitle:buildImageSubtitle(recipe)
    },
    composed_at:nowIso()
  };

  writeJsonAtomic(p.meta, meta);
  return finalPath;
}

function enqueueImageJob(page, recipe, job) {
  job.image_attempts = Number(job.image_attempts || 0) + 1;
  const id = `foodimg-${job.date}-${page.page_key}-${recipeCode(recipe.id)}-a${job.image_attempts}`;
  enqueueOperatorJob(db, {
    id,
    action:'generate_food_image',
    payload:{
      prompt:buildImagePrompt(page, recipe),
      recipe_code:recipeCode(recipe.id),
      recipe_title:recipe.title,
      page_key:page.page_key
    }
  });
  job.image_job_id = id;
  job.status = 'WAITING_IMAGE';
  return id;
}

function enqueuePostJob(page, recipe, job, finalPath) {
  const id = `foodpost-${job.date}-${page.page_key}-${recipeCode(recipe.id)}`;
  const assetToken = crypto.randomBytes(24).toString('hex');
  const imageUrl = `http://127.0.0.1:3210/v1/assets/${encodeURIComponent(id)}?token=${assetToken}`;

  enqueueOperatorJob(db, {
    id,
    action:'post_page',
    payload:{
      page_url:page.page_url,
      page_name:page.page_name,
      message:buildCaption(page, recipe),
      image_url:imageUrl,
      local_image_path:finalPath,
      asset_token:assetToken
    }
  });
  job.post_job_id = id;
  job.status = 'POSTING';
  return id;
}

function markStateUsed(page, state, recipe, postRef) {
  const item = state.recipes.find(x => Number(x.id) === Number(recipe.id));
  if (!item) throw new Error('Recipe không tồn tại trong local state');
  item.used = true;
  item.posted_date = vnDate();
  item.posted_at = nowIso();
  item.post_ref = postRef || null;
  state.last_post_date = vnDate();
  state.last_post_ref = postRef || null;
  saveState(page, state);
}

async function processImageStage(page, recipe, job) {
  const p = mealPaths(recipe);
  const sourceMeta = safeJsonRead(p.meta, {}) || {};
  const sourceIsCurrentPoster =
    fs.existsSync(p.source) &&
    sourceMeta?.source?.layout === CHATGPT_POSTER_LAYOUT;

  if (sourceIsCurrentPoster) {
    job.status = 'IMAGE_READY';
    return true;
  }

  if (fs.existsSync(p.source) && !sourceIsCurrentPoster) {
    job.stale_source_detected = true;
    job.stale_source_layout = sourceMeta?.source?.layout || 'legacy-unversioned';
  }

  if (!job.image_job_id) {
    enqueueImageJob(page, recipe, job);
    return false;
  }

  let row = getOperatorJob(job.image_job_id);
  row = markStaleImageJob(row);
  if (!row) {
    job.image_job_id = null;
    job.status = 'IMAGE_JOB_MISSING';
    return false;
  }

  if (['QUEUED','EXTENSION_QUEUED','PROCESSING'].includes(row.status)) {
    job.status = 'WAITING_IMAGE';
    return false;
  }

  if (row.status === 'DONE') {
    const result = operatorResult(row);
    if (!result.verified_download || !result.download_path) {
      throw new Error('Extension báo DONE nhưng không có download_path đã xác minh');
    }
    const imported = await importDownloadedImage(result.download_path, recipe);
    job.status = 'IMAGE_READY';
    job.source_path = imported.source;
    job.source_sha256 = imported.sha256;
    return true;
  }

  const maxAttempts = Math.max(1, Number(config.image_generation?.max_attempts || 2));
  if (Number(job.image_attempts || 0) < maxAttempts) {
    log('IMAGE_RETRY', {
      page_key:page.page_key,
      recipe_code:recipeCode(recipe.id),
      previous_job:row.id,
      previous_status:row.status,
      error:row.error || null
    });
    job.image_job_id = null;
    job.status = 'IMAGE_RETRY_PENDING';
    return false;
  }

  job.status = 'FAILED_IMAGE';
  job.error = row.error || `Image job kết thúc ở trạng thái ${row.status}`;
  return false;
}

function processPostResult(page, state, recipe, job) {
  const row = getOperatorJob(job.post_job_id);
  if (!row) {
    job.status = 'FAILED_POST';
    job.error = 'Không tìm thấy post job';
    return false;
  }

  if (['QUEUED','EXTENSION_QUEUED','PROCESSING'].includes(row.status)) {
    job.status = 'POSTING';
    return false;
  }

  const result = operatorResult(row);
  if (row.status === 'DONE' && result.verified === true) {
    const postRef = result.post_id || result.post_url || result.page_url || row.id;
    markStateUsed(page, state, recipe, postRef);
    job.status = 'VERIFIED';
    job.post_ref = postRef;
    job.verified_at = nowIso();
    return true;
  }

  if (result.clicked_post === true) {
    job.status = 'NEEDS_VERIFY';
    job.error = row.error || 'Facebook đã nhận thao tác Đăng nhưng chưa xác minh được; không tự đăng lại để tránh trùng';
    return false;
  }

  job.status = 'FAILED_POST';
  job.error = row.error || `Post job kết thúc ở trạng thái ${row.status}`;
  return false;
}

async function processPage(page) {
  if (!page.enabled) return;

  const now = new Date();
  const due = dueInfo(page, now);
  const state = loadState(page);

  if (state.last_post_date === due.date) return;
  let job = loadJob(page, due.date);

  if (due.before) return;

  if (due.late && !job) {
    job = {
      version:1,
      id:`food-${due.date}-${page.page_key}-late`,
      date:due.date,
      page:{ id:String(page.page_id), key:page.page_key, name:page.page_name },
      scheduled_at:due.scheduled_at,
      deadline_at:due.deadline_at,
      status:'SKIPPED_LATE',
      reason:'Máy/agent hoạt động sau cửa sổ catch-up',
      created_at:nowIso(),
      updated_at:nowIso()
    };
    saveJob(page, due.date, job);
    log('SKIPPED_LATE', { page_key:page.page_key, date:due.date });
    return;
  }

  if (!due.due && !job) return;

  if (!job) {
    const recipe = chooseRecipe(page, state, due.date);
    if (!recipe) throw new Error(`Không chọn được recipe cho ${page.page_key}`);
    job = createDailyJob(page, due.date, due, recipe);
    saveJob(page, due.date, job);
    log('JOB_CREATED', {
      page_key:page.page_key,
      recipe_code:job.recipe.code,
      recipe_title:job.recipe.title,
      scheduled_at:job.scheduled_at
    });
  }

  if (['VERIFIED','SKIPPED_LATE','FAILED_IMAGE','FAILED_POST','NEEDS_VERIFY'].includes(job.status)) return;

  const recipe = foodRecipes().find(x => Number(x.id) === Number(job.recipe?.id));
  if (!recipe) {
    job.status = 'FAILED';
    job.error = 'Recipe của job không còn tồn tại';
    saveJob(page, due.date, job);
    return;
  }

  const imageReady = await processImageStage(page, recipe, job);
  saveJob(page, due.date, job);
  if (!imageReady) return;

  if (!job.final_path || !fs.existsSync(job.final_path)) {
    job.final_path = await composeFinal(page, recipe);
    job.status = 'COMPOSED';
    saveJob(page, due.date, job);
    log('IMAGE_COMPOSED', {
      page_key:page.page_key,
      recipe_code:recipeCode(recipe.id),
      final_path:job.final_path
    });
  }

  if (config.publish?.enabled !== true) {
    job.status = 'READY_TO_PUBLISH_DISABLED';
    saveJob(page, due.date, job);
    return;
  }

  if (!job.post_job_id) {
    enqueuePostJob(page, recipe, job, job.final_path);
    saveJob(page, due.date, job);
    log('POST_ENQUEUED', {
      page_key:page.page_key,
      recipe_code:recipeCode(recipe.id),
      post_job_id:job.post_job_id
    });
    return;
  }

  const verified = processPostResult(page, state, recipe, job);
  saveJob(page, due.date, job);
  if (verified) {
    log('POST_VERIFIED', {
      page_key:page.page_key,
      recipe_code:recipeCode(recipe.id),
      post_ref:job.post_ref
    });
  }
}

async function bridgeHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const r = await fetch('http://127.0.0.1:3210/v1/health', {
      cache:'no-store',
      signal:controller.signal
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureBridge() {
  let health = await bridgeHealth();
  if (health?.ok) {
    if (String(health.expected_version || '') !== '2.1.3') {
      throw new Error(`Bridge đang chạy phiên bản cũ expected_version=${health.expected_version || 'unknown'}; cần restart`);
    }
    return health;
  }

  await import('../src/chrome-extension-bridge.js');
  for (let i = 0; i < 20; i += 1) {
    await new Promise(r => setTimeout(r, 250));
    health = await bridgeHealth();
    if (health?.ok) return health;
  }
  throw new Error('Không khởi động được Chrome Extension bridge');
}

async function doctor() {
  const health = await bridgeHealth();
  const result = {
    ok:true,
    repo_root:REPO_ROOT,
    config_path:CONFIG_PATH,
    db_path:DB_PATH,
    image_root:IMAGE_ROOT,
    download_root:DOWNLOAD_ROOT,
    image_root_exists:fs.existsSync(IMAGE_ROOT),
    config_pages:(config.pages || []).map(p => ({
      page_key:p.page_key,
      page_id:p.page_id,
      enabled:Boolean(p.enabled),
      selected_hour_today:selectedHour(p, vnDate())
    })),
    publish_enabled:config.publish?.enabled === true,
    bridge:health ? {
      ok:Boolean(health.ok),
      expected_version:health.expected_version || null,
      paired:Boolean(health.paired),
      extension_online:Boolean(health.extension_online)
    } : null
  };
  console.log('FOOD_AGENT_DOCTOR=' + JSON.stringify(result));
  return result;
}

let tickBusy = false;

async function tick() {
  if (tickBusy) return;
  tickBusy = true;
  try {
    for (const page of config.pages || []) {
      try {
        await processPage(page);
      } catch (error) {
        log('PAGE_ERROR', {
          page_key:page.page_key,
          error:String(error?.message || error)
        });
      }
    }
  } finally {
    tickBusy = false;
  }
}

async function main() {
  if (process.argv.includes('--doctor')) {
    await doctor();
    db.close();
    return;
  }

  const health = await ensureBridge();
  log('AGENT_STARTED', {
    image_root:IMAGE_ROOT,
    publish_enabled:config.publish?.enabled === true,
    bridge_paired:Boolean(health?.paired),
    extension_online:Boolean(health?.extension_online)
  });

  await tick();
  const intervalMs = Math.max(5000, Number(config.schedule?.tick_seconds || 15) * 1000);
  setInterval(() => tick().catch(error => log('TICK_ERROR', { error:String(error?.message || error) })), intervalMs);
}

main().catch(error => {
  console.error('FOOD_AGENT_FATAL=' + String(error?.stack || error));
  process.exitCode = 1;
});
