import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { foodPageBlueprints, foodRecipes, pickRecipeForPage, buildRecipePost, localDateInVietnam } from '../src/food-network-core.js';

const PAGE_SLOT = Number(process.env.FOOD_PAGE_SLOT || 5);
const PAGE_NAME = String(process.env.FOOD_PAGE_NAME || 'Hôm Nay Ăn Gì?').trim();
const PAGE_ID = String(process.env.FACEBOOK_PAGE_ID || '1358329424025816').trim();
const STATE_KEY = String(process.env.FOOD_STATE_KEY || 'hom-nay-an-gi').trim().toLowerCase();
const PAGE_HASHTAG = String(process.env.FOOD_PAGE_HASHTAG || '#HomNayAnGi').trim();
const BRAND_LINE_1 = String(process.env.FOOD_BRAND_LINE_1 || 'HÔM NAY').trim();
const BRAND_LINE_2 = String(process.env.FOOD_BRAND_LINE_2 || 'ĂN GÌ?').trim();
const BRAND_SUBTITLE = String(process.env.FOOD_BRAND_SUBTITLE || 'MÓN NGON MỖI NGÀY').trim();
const FOOD_IMAGE_PROVIDER = String(process.env.FOOD_IMAGE_PROVIDER || 'library').trim().toLowerCase();
const MANUAL_TARGET = String(process.env.FOOD_MANUAL_TARGET || 'all').trim().toLowerCase();
let TOKEN = String(process.env.META_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim();
const GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || 'v26.0').trim();
const PUBLISH = String(process.env.CLOUD_FOOD_PUBLISH || 'false').toLowerCase() === 'true';
const DATE = String(process.env.FOOD_DATE || localDateInVietnam()).trim();
const outDir = path.resolve(process.cwd(), 'artifacts', 'cloud-food', STATE_KEY);
const TRIGGER_CRON = String(process.env.CLOUD_TRIGGER_CRON || '').trim();
const SCHEDULE_ENABLED = String(process.env.FOOD_SCHEDULE_ENABLED || 'true').toLowerCase() === 'true';

if (!Number.isInteger(PAGE_SLOT) || PAGE_SLOT < 1) throw new Error('FOOD_PAGE_SLOT không hợp lệ');
if (!/^\d+$/.test(PAGE_ID)) throw new Error('FACEBOOK_PAGE_ID không hợp lệ');
if (!/^[a-z0-9-]+$/.test(STATE_KEY)) throw new Error('FOOD_STATE_KEY không hợp lệ');

const STATE_JSON = path.resolve(process.cwd(), 'content', `${STATE_KEY}-recipe-state.json`);
const STATE_CSV = path.resolve(process.cwd(), 'content', `${STATE_KEY}-recipe-state.csv`);

function selectedPostingHourVN(date) {
  const digest = crypto.createHash('sha256')
    .update(`${date}:${PAGE_ID}:daily-window-v1`)
    .digest();
  return 8 + (digest[0] % 6); // 08,09,10,11,12,13
}

function triggerHourVN(cron) {
  const m = String(cron || '').match(/^0\s+([1-6])\s+\*\s+\*\s+\*$/);
  return m ? Number(m[1]) + 7 : null;
}

const SELECTED_HOUR_VN = selectedPostingHourVN(DATE);
const TRIGGER_HOUR_VN = triggerHourVN(TRIGGER_CRON);
const SCHEDULE_EVENT = Boolean(TRIGGER_CRON);

fs.mkdirSync(outDir, { recursive: true });

if (!SCHEDULE_EVENT && MANUAL_TARGET !== 'all' && MANUAL_TARGET !== STATE_KEY) {
  const result = {
    status:'MANUAL_TARGET_SKIPPED',
    date:DATE,
    page:{ id:PAGE_ID, name:PAGE_NAME },
    state_key:STATE_KEY,
    requested_target:MANUAL_TARGET,
    publish_requested:PUBLISH
  };
  fs.writeFileSync(path.join(outDir, `${DATE}-manual-target-skipped.json`), JSON.stringify(result,null,2), 'utf8');
  console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
  process.exit(0);
}

if (SCHEDULE_EVENT && !SCHEDULE_ENABLED) {
  const result = {
    status:'SCHEDULE_DISABLED',
    date:DATE,
    page:{ id:PAGE_ID, name:PAGE_NAME },
    publish_requested:PUBLISH
  };
  fs.writeFileSync(path.join(outDir, `${DATE}-schedule-disabled.json`), JSON.stringify(result,null,2), 'utf8');
  console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
  process.exit(0);
}

if (SCHEDULE_EVENT && TRIGGER_HOUR_VN !== SELECTED_HOUR_VN) {
  const result = {
    status:'NOT_DUE',
    date:DATE,
    page:{ id:PAGE_ID, name:PAGE_NAME },
    selected_hour_local:`${String(SELECTED_HOUR_VN).padStart(2,'0')}:00`,
    trigger_hour_local:TRIGGER_HOUR_VN == null ? null : `${String(TRIGGER_HOUR_VN).padStart(2,'0')}:00`,
    publish_requested:PUBLISH
  };
  fs.writeFileSync(path.join(outDir, `${DATE}-not-due.json`), JSON.stringify(result,null,2), 'utf8');
  console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
  process.exit(0);
}

function xml(value = '') {
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&apos;');
}

function slug(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
}

function norm(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
}


function recipeMarker(id) {
  return `#RID${String(Number(id)).padStart(3,'0')}`;
}

function csvCell(value='') {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}

function catalogState() {
  return {
    version:1,
    page_id:PAGE_ID,
    page_name:PAGE_NAME,
    updated_at:null,
    last_post_date:null,
    last_post_id:null,
    notes:'Authoritative recipe usage state. used=true means never select this recipe again unless manually reset.',
    recipes:foodRecipes().map(r => ({
      id:r.id,
      title:r.title,
      category:r.category,
      used:false,
      posted_date:null,
      posted_at:null,
      facebook_post_id:null
    }))
  };
}

function loadRecipeState() {
  let state = catalogState();
  if (fs.existsSync(STATE_JSON)) {
    const parsed = JSON.parse(fs.readFileSync(STATE_JSON,'utf8'));
    if (String(parsed?.page_id || PAGE_ID) !== PAGE_ID) {
      throw new Error('Recipe state thuộc Page khác; dừng để tránh đánh dấu sai');
    }
    state = { ...state, ...parsed };
  }

  const previous = new Map((state.recipes || []).map(x => [Number(x.id), x]));
  state.recipes = foodRecipes().map(r => {
    const old = previous.get(Number(r.id)) || {};
    return {
      id:r.id,
      title:r.title,
      category:r.category,
      used:Boolean(old.used),
      posted_date:old.posted_date || null,
      posted_at:old.posted_at || null,
      facebook_post_id:old.facebook_post_id || null
    };
  });
  state.page_id = PAGE_ID;
  state.page_name = PAGE_NAME;
  state.version = 1;
  return state;
}

function saveRecipeState(state) {
  state.updated_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(STATE_JSON), { recursive:true });
  fs.writeFileSync(STATE_JSON, JSON.stringify(state,null,2)+'\n','utf8');

  const rows = [
    ['id','title','category','used','posted_date','posted_at','facebook_post_id'],
    ...(state.recipes || []).map(r => [
      r.id,r.title,r.category,Boolean(r.used),r.posted_date || '',r.posted_at || '',r.facebook_post_id || ''
    ])
  ];
  fs.writeFileSync(STATE_CSV, rows.map(row => row.map(csvCell).join(',')).join('\n')+'\n','utf8');
}

function usedRecipeIds(state) {
  return (state.recipes || []).filter(r => r.used).map(r => Number(r.id)).filter(Number.isFinite);
}

function markRecipeUsed(state, recipeId, { date=DATE, postId=null, postedAt=new Date().toISOString() } = {}) {
  const item = (state.recipes || []).find(r => Number(r.id) === Number(recipeId));
  if (!item) throw new Error(`Không tìm thấy recipe_id=${recipeId} trong state`);
  item.used = true;
  item.posted_date = date;
  item.posted_at = postedAt;
  item.facebook_post_id = postId || item.facebook_post_id || null;
}

function vietnamDayBounds(date) {
  return {
    start:Math.floor(Date.parse(`${date}T00:00:00+07:00`) / 1000),
    end:Math.floor(Date.parse(`${date}T23:59:59+07:00`) / 1000)
  };
}

async function resolvePageAccessToken(sourceToken) {
  const token = String(sourceToken || '').trim();
  if (!token) return '';

  async function graph(pathname, candidateToken = token) {
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pathname}`, {
      headers:{ Authorization:`Bearer ${candidateToken}` }
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body?.error) {
      const error = new Error(body?.error?.message || `Meta Graph HTTP ${r.status}`);
      error.metaCode = body?.error?.code ?? 'unknown';
      throw error;
    }
    return body;
  }

  let me = null;
  try {
    me = await graph('me?fields=id,name');
  } catch (error) {
    throw new Error(`Không xác minh được Meta token, code=${error.metaCode ?? 'unknown'}`);
  }

  if (String(me?.id || '') === PAGE_ID) {
    console.log('META_TOKEN_MODE=PAGE');
    return token;
  }

  // Preferred path for User tokens: ask the target Page directly for its
  // Page Access Token. This avoids scanning every managed Page.
  try {
    const target = await graph(`${PAGE_ID}?fields=id,name,access_token`);
    if (target?.access_token) {
      console.log('META_TOKEN_MODE=USER_TO_PAGE');
      console.log(`META_TARGET_PAGE_RESOLVED=${target.id} ${target.name || ''}`);
      return String(target.access_token).trim();
    }
  } catch {
    // Continue to compatibility fallbacks below.
  }

  // Compatibility path for normal User tokens.
  try {
    const accounts = await graph('me/accounts?fields=id,name,access_token&limit=100');
    const target = (accounts.data || []).find(x => String(x?.id || '') === PAGE_ID);
    if (target?.access_token) {
      console.log('META_TOKEN_MODE=USER_TO_PAGE_LIST');
      console.log(`META_TARGET_PAGE_RESOLVED=${target.id} ${target.name || ''}`);
      return String(target.access_token).trim();
    }
  } catch {
    // System User tokens do not always behave like normal Facebook User
    // tokens on /me/accounts. Test direct asset access instead.
  }

  // System User mode: the Business System User must have this Page assigned
  // and the token must carry the required Pages permissions. In that setup,
  // the source token can act on the assigned Page directly.
  try {
    const target = await graph(`${PAGE_ID}?fields=id,name`);
    if (String(target?.id || '') === PAGE_ID) {
      console.log('META_TOKEN_MODE=SYSTEM_USER_DIRECT');
      console.log(`META_TARGET_PAGE_RESOLVED=${target.id} ${target.name || ''}`);
      return token;
    }
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error(
    `Token không truy cập được PAGE_ID=${PAGE_ID}; kiểm tra System User/User đã được gán Page và quyền Pages`
  );
}

async function checkTodayRecentPosts() {
  if (!TOKEN) {
    if (PUBLISH) throw new Error('Thiếu META_ACCESS_TOKEN/FACEBOOK_PAGE_ACCESS_TOKEN nên không thể kiểm tra chống đăng trùng trong ngày');
    return { found:false, checked:false };
  }

  const { start, end } = vietnamDayBounds(DATE);
  const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}/posts`);
  u.searchParams.set('fields','id,message,created_time');
  u.searchParams.set('since',String(start));
  u.searchParams.set('until',String(end));
  u.searchParams.set('limit','10');
  u.searchParams.set('access_token',TOKEN);

  const r = await fetch(u);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.error) {
    throw new Error(body?.error?.message || `Không kiểm tra được bài hôm nay HTTP ${r.status}`);
  }

  const recipes = foodRecipes();
  for (const post of body.data || []) {
    const message = String(post?.message || '');
    const rid = message.match(/#RID(\d{1,5})\b/i);
    let recipeId = rid ? Number(rid[1]) : null;

    if (!recipeId) {
      const normalized = norm(message);
      const hit = recipes.find(x => normalized.includes(norm(x.title)));
      recipeId = hit?.id || null;
    }

    if (message.toLowerCase().includes(PAGE_HASHTAG.toLowerCase()) || rid || recipeId) {
      return {
        found:true,
        checked:true,
        recipeId,
        postId:String(post?.id || ''),
        createdTime:String(post?.created_time || '')
      };
    }
  }
  return { found:false, checked:true };
}

function wrapWords(text, maxChars) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0,3);
}

function brandOverlay({ title, hasPhoto, ingredients }) {
  const titleLines = wrapWords(title.toUpperCase(), 18);
  const titleSvg = titleLines.map((line,i)=>
    `<text x="80" y="${hasPhoto ? 760 + i*82 : 520 + i*92}" font-size="${hasPhoto ? 66 : 76}" font-weight="900" fill="${hasPhoto ? '#fffaf0' : '#4b2712'}" font-family="Arial,Segoe UI,sans-serif">${xml(line)}</text>`
  ).join('');

  const ing = ingredients.slice(0,3).map((x,i)=>
    `<text x="84" y="${760 + i*48}" font-size="30" font-weight="600" fill="#7b4a27" font-family="Arial,Segoe UI,sans-serif">• ${xml(x)}</text>`
  ).join('');

  return Buffer.from(`<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#3b1e0d" stop-opacity=".78"/>
      </linearGradient>
      <linearGradient id="warm" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff8eb"/>
        <stop offset=".58" stop-color="#f3d9ae"/>
        <stop offset="1" stop-color="#e7b36f"/>
      </linearGradient>
    </defs>

    ${hasPhoto ? '<rect x="0" y="520" width="1080" height="560" fill="url(#fade)"/>' : '<rect width="1080" height="1080" fill="url(#warm)"/><circle cx="930" cy="160" r="180" fill="#d9762d" opacity=".18"/><circle cx="865" cy="930" r="240" fill="#82a44e" opacity=".18"/><circle cx="120" cy="160" r="120" fill="#c56b2c" opacity=".12"/>'}

    <g transform="translate(68,64)">
      <circle cx="112" cy="112" r="108" fill="#fffaf0" stroke="#6d3b18" stroke-width="10"/>
      <text x="112" y="90" text-anchor="middle" font-size="38" font-weight="900" fill="#4b2712" font-family="Arial,Segoe UI,sans-serif">${xml(BRAND_LINE_1)}</text>
      <text x="112" y="140" text-anchor="middle" font-size="46" font-weight="900" fill="#4b2712" font-family="Arial,Segoe UI,sans-serif">${xml(BRAND_LINE_2)}</text>
      <text x="112" y="174" text-anchor="middle" font-size="17" font-weight="700" fill="#8c4f24" font-family="Arial,Segoe UI,sans-serif">${xml(BRAND_SUBTITLE)}</text>
    </g>

    ${titleSvg}
    ${hasPhoto ? '<text x="82" y="1015" font-size="27" font-weight="700" fill="#f9e4c5" font-family="Arial,Segoe UI,sans-serif">Công thức dễ làm • Mẹo bếp thực tế</text>' : ing}
  </svg>`);
}

function recipeFileStem(id) {
  return `RID${String(Number(id)).padStart(3,'0')}`;
}

function libraryImageCandidates(recipe) {
  const dir = path.resolve(process.cwd(), 'content', 'food-images', STATE_KEY);
  const stem = recipeFileStem(recipe.id);
  const exts = ['.jpg','.jpeg','.png','.webp'];
  return exts.map(ext => path.join(dir, `${stem}${ext}`));
}

function findLibraryImage(recipe) {
  return libraryImageCandidates(recipe).find(file => fs.existsSync(file)) || null;
}

async function buildImage(recipe) {
  if (FOOD_IMAGE_PROVIDER !== 'library') {
    throw new Error(`FOOD_IMAGE_PROVIDER không hỗ trợ: ${FOOD_IMAGE_PROVIDER}`);
  }

  const source = findLibraryImage(recipe);
  const expectedPath = path.posix.join(
    'content',
    'food-images',
    STATE_KEY,
    `${recipeFileStem(recipe.id)}.jpg`
  );

  if (!source) {
    return {
      missing:true,
      provider:'library',
      expectedPath,
      acceptedExtensions:['jpg','jpeg','png','webp']
    };
  }

  const out = path.join(outDir, `${DATE}-${slug(recipe.title)}.jpg`);

  const base = await sharp(source)
    .rotate()
    .resize(1080,1080,{ fit:'cover', position:'centre' })
    .jpeg({ quality:92 })
    .toBuffer();

  await sharp(base)
    .composite([{
      input:brandOverlay({
        title:recipe.title,
        hasPhoto:true,
        ingredients:recipe.ingredients
      })
    }])
    .jpeg({ quality:92 })
    .toFile(out);

  return {
    missing:false,
    path:out,
    provider:'library',
    sourcePath:source,
    expectedPath,
    fallback:false
  };
}

async function publishPhoto(file, caption) {
  if (!TOKEN) throw new Error('Thiếu META_ACCESS_TOKEN/FACEBOOK_PAGE_ACCESS_TOKEN');
  const buf = fs.readFileSync(file);
  const form = new FormData();
  form.set('access_token', TOKEN);
  form.set('caption', caption);
  form.set('source', new Blob([buf], { type:'image/jpeg' }), path.basename(file));
  const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}/photos`, {
    method:'POST',
    body:form
  });
  const body = await r.json().catch(()=>({}));
  if (!r.ok || body?.error) throw new Error(body?.error?.message || `Meta Graph HTTP ${r.status}`);
  return body;
}

const blueprint = foodPageBlueprints().find(x => x.slot === PAGE_SLOT);
if (!blueprint) throw new Error(`Không tìm thấy blueprint slot=${PAGE_SLOT}`);
const page = { ...blueprint, name:PAGE_NAME };

const state = loadRecipeState();

if (state.last_post_date === DATE) {
  const result = {
    status:'ALREADY_POSTED_TODAY',
    publish_requested:PUBLISH,
    date:DATE,
    selected_hour_local:`${String(SELECTED_HOUR_VN).padStart(2,'0')}:00`,
    trigger_hour_local:TRIGGER_HOUR_VN == null ? null : `${String(TRIGGER_HOUR_VN).padStart(2,'0')}:00`,
    page:{ id:PAGE_ID, name:PAGE_NAME },
    state:{ used_count:usedRecipeIds(state).length, total:state.recipes.length, source:path.relative(process.cwd(),STATE_JSON) },
    published:null
  };
  fs.writeFileSync(path.join(outDir, `${DATE}-result.json`), JSON.stringify(result,null,2),'utf8');
  console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
  process.exit(0);
}

if (TOKEN) {
  TOKEN = await resolvePageAccessToken(TOKEN);
}

// Small recovery check only for today's recent posts. No full Page-history scan.
const todayCheck = await checkTodayRecentPosts();
if (todayCheck.found) {
  if (todayCheck.recipeId) {
    markRecipeUsed(state, todayCheck.recipeId, {
      date:DATE,
      postId:todayCheck.postId || null,
      postedAt:todayCheck.createdTime || new Date().toISOString()
    });
  }
  state.last_post_date = DATE;
  state.last_post_id = todayCheck.postId || state.last_post_id || null;
  saveRecipeState(state);

  const result = {
    status:'RECOVERED_ALREADY_POSTED_TODAY',
    publish_requested:PUBLISH,
    date:DATE,
    page:{ id:PAGE_ID, name:PAGE_NAME },
    recovered_recipe_id:todayCheck.recipeId || null,
    recovered_post_id:todayCheck.postId || null,
    state:{ used_count:usedRecipeIds(state).length, total:state.recipes.length, source:path.relative(process.cwd(),STATE_JSON) },
    published:null
  };
  fs.writeFileSync(path.join(outDir, `${DATE}-result.json`), JSON.stringify(result,null,2),'utf8');
  console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
  process.exit(0);
}

const allRecipes = foodRecipes();
const usedIds = usedRecipeIds(state);
const usedSet = new Set(usedIds);

if (allRecipes.every(r => usedSet.has(Number(r.id)))) {
  const result = {
    status:'NO_UNUSED_RECIPE',
    publish_requested:PUBLISH,
    date:DATE,
    page:{ id:PAGE_ID, name:PAGE_NAME },
    state:{ used_count:usedIds.length, total:allRecipes.length, remaining:0, source:path.relative(process.cwd(),STATE_JSON) },
    published:null
  };
  fs.writeFileSync(path.join(outDir, `${DATE}-result.json`), JSON.stringify(result,null,2),'utf8');
  console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
  process.exit(0);
}

const recipe = pickRecipeForPage({
  pageSlot:PAGE_SLOT,
  date:DATE,
  usedRecipeIds:usedIds
});

if (!recipe || usedSet.has(Number(recipe.id))) {
  throw new Error('Không chọn được món mới chưa dùng trong recipe state');
}

const rendered = buildRecipePost({ page:{...page,name:PAGE_NAME}, recipe });
const image = await buildImage(recipe);
let caption = `${rendered.content}\n\n${PAGE_HASHTAG} ${recipeMarker(recipe.id)}`;

if (image.missing) {
  const result = {
    status:'AWAITING_IMAGE',
    publish_requested:PUBLISH,
    date:DATE,
    selected_hour_local:`${String(SELECTED_HOUR_VN).padStart(2,'0')}:00`,
    trigger_hour_local:TRIGGER_HOUR_VN == null ? null : `${String(TRIGGER_HOUR_VN).padStart(2,'0')}:00`,
    page:{ id:PAGE_ID, name:PAGE_NAME },
    recipe:{ id:recipe.id, title:recipe.title, marker:recipeMarker(recipe.id) },
    image:{
      provider:'library',
      expected_path:image.expectedPath,
      accepted_extensions:image.acceptedExtensions
    },
    published:null,
    caption_preview:caption.slice(0,700)
  };
  fs.writeFileSync(path.join(outDir, `${DATE}-result.json`), JSON.stringify(result,null,2),'utf8');
  console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
  process.exit(0);
}

let published = null;
let status = 'DRY_RUN';

if (PUBLISH) {
  published = await publishPhoto(image.path, caption);
  const postId = String(published?.post_id || published?.id || '');
  markRecipeUsed(state, recipe.id, {
    date:DATE,
    postId:postId || null,
    postedAt:new Date().toISOString()
  });
  state.last_post_date = DATE;
  state.last_post_id = postId || null;
  saveRecipeState(state);
  status = 'PUBLISHED';
}

const result = {
  status,
  publish_requested:PUBLISH,
  date:DATE,
  selected_hour_local:`${String(SELECTED_HOUR_VN).padStart(2,'0')}:00`,
  trigger_hour_local:TRIGGER_HOUR_VN == null ? null : `${String(TRIGGER_HOUR_VN).padStart(2,'0')}:00`,
  page:{ id:PAGE_ID, name:PAGE_NAME },
  recipe:{ id:recipe.id, title:recipe.title, marker:recipeMarker(recipe.id) },
  state:{
    used_count:usedRecipeIds(state).length,
    total:state.recipes.length,
    remaining:state.recipes.length-usedRecipeIds(state).length,
    source:path.relative(process.cwd(),STATE_JSON),
    csv:path.relative(process.cwd(),STATE_CSV)
  },
  today_check:todayCheck,
  image:{
    path:image.path,
    provider:image.provider,
    source_path:path.relative(process.cwd(), image.sourcePath),
    expected_path:image.expectedPath,
    fallback:false
  },
  published,
  caption_preview:caption.slice(0,700)
};

fs.writeFileSync(path.join(outDir, `${DATE}-result.json`), JSON.stringify(result,null,2),'utf8');
console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
