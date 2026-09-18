import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { foodPageBlueprints, pickRecipeForPage, buildRecipePost, localDateInVietnam } from '../src/food-network-core.js';

const PAGE_SLOT = 5;
const PAGE_NAME = 'Hôm Nay Ăn Gì?';
const PAGE_ID = String(process.env.FACEBOOK_PAGE_ID || '61594459680780').trim();
const TOKEN = String(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim();
const GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || 'v26.0').trim();
const PUBLISH = String(process.env.CLOUD_FOOD_PUBLISH || 'false').toLowerCase() === 'true';
const DATE = String(process.env.FOOD_DATE || localDateInVietnam()).trim();
const outDir = path.resolve(process.cwd(), 'artifacts', 'cloud-food');
const TRIGGER_CRON = String(process.env.CLOUD_TRIGGER_CRON || '').trim();

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

function stripHtml(value='') {
  return String(value).replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim();
}

async function publicDomainFoodImage(title) {
  const wanted = norm(title).split(' ').filter(x => x.length >= 3);
  for (const query of [`"${title}"`, title, `${title} món ăn`]) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    u.searchParams.set('action','query');
    u.searchParams.set('format','json');
    u.searchParams.set('generator','search');
    u.searchParams.set('gsrnamespace','6');
    u.searchParams.set('gsrlimit','20');
    u.searchParams.set('gsrsearch',query);
    u.searchParams.set('prop','imageinfo');
    u.searchParams.set('iiprop','url|mime|extmetadata');
    u.searchParams.set('iiurlwidth','1600');
    const r = await fetch(u, { headers: { 'User-Agent':'Social-Manager-Cloud-Food/2.1' } });
    if (!r.ok) continue;
    const body = await r.json().catch(() => ({}));
    const pages = Object.values(body?.query?.pages || {}).sort((a,b)=>Number(a.index||999)-Number(b.index||999));
    for (const item of pages) {
      const ii = item?.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|webp)$/i.test(String(ii.mime||''))) continue;
      const meta = ii.extmetadata || {};
      const license = stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value || '');
      if (!/(CC0|Public domain|Public Domain)/i.test(license)) continue;
      const hay = norm(`${item.title||''} ${stripHtml(meta.ImageDescription?.value||'')}`);
      const relevance = wanted.filter(t => hay.includes(t)).length;
      if (wanted.length && relevance === 0) continue;
      const imageUrl = ii.thumburl || ii.url;
      if (!imageUrl) continue;
      return {
        imageUrl,
        sourceUrl: ii.descriptionurl || ii.descriptionshorturl || '',
        license: license || 'Public domain',
        title: item.title || '',
        relevance
      };
    }
  }
  return null;
}

async function download(url) {
  const r = await fetch(url, { headers: { 'User-Agent':'Social-Manager-Cloud-Food/2.1' } });
  if (!r.ok) throw new Error(`Không tải được ảnh nền HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
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
      <text x="112" y="90" text-anchor="middle" font-size="38" font-weight="900" fill="#4b2712" font-family="Arial,Segoe UI,sans-serif">HÔM NAY</text>
      <text x="112" y="140" text-anchor="middle" font-size="46" font-weight="900" fill="#4b2712" font-family="Arial,Segoe UI,sans-serif">ĂN GÌ?</text>
      <text x="112" y="174" text-anchor="middle" font-size="17" font-weight="700" fill="#8c4f24" font-family="Arial,Segoe UI,sans-serif">MÓN NGON MỖI NGÀY</text>
    </g>

    ${titleSvg}
    ${hasPhoto ? '<text x="82" y="1015" font-size="27" font-weight="700" fill="#f9e4c5" font-family="Arial,Segoe UI,sans-serif">Công thức dễ làm • Mẹo bếp thực tế</text>' : ing}
  </svg>`);
}

async function buildImage(recipe) {
  const background = await publicDomainFoodImage(recipe.title).catch(() => null);
  const out = path.join(outDir, `${DATE}-${slug(recipe.title)}.jpg`);

  if (background?.imageUrl) {
    const input = await download(background.imageUrl);
    const base = await sharp(input)
      .resize(1080,1080,{fit:'cover',position:'centre'})
      .jpeg({quality:90})
      .toBuffer();
    await sharp(base)
      .composite([{ input: brandOverlay({ title:recipe.title, hasPhoto:true, ingredients:recipe.ingredients }) }])
      .jpeg({quality:91})
      .toFile(out);
    return { path:out, background };
  }

  const blank = {
    create: { width:1080, height:1080, channels:3, background:'#fff8eb' }
  };
  await sharp(blank)
    .composite([{ input: brandOverlay({ title:recipe.title, hasPhoto:false, ingredients:recipe.ingredients }) }])
    .jpeg({quality:92})
    .toFile(out);
  return { path:out, background:null };
}

function vietnamDayBounds(date) {
  const start = Date.parse(`${date}T00:00:00+07:00`) / 1000;
  const end = Date.parse(`${date}T23:59:59+07:00`) / 1000;
  return { start: Math.floor(start), end: Math.floor(end) };
}

async function alreadyPosted({ recipeTitle }) {
  if (!TOKEN) return false;
  const { start, end } = vietnamDayBounds(DATE);
  const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}/posts`);
  u.searchParams.set('fields','id,message,created_time');
  u.searchParams.set('since',String(start));
  u.searchParams.set('until',String(end));
  u.searchParams.set('limit','25');
  u.searchParams.set('access_token',TOKEN);
  const r = await fetch(u);
  const body = await r.json().catch(()=>({}));
  if (!r.ok || body?.error) return false;
  return (body.data || []).some(p =>
    String(p.message || '').includes(recipeTitle) &&
    String(p.message || '').includes('#HomNayAnGi')
  );
}

async function publishPhoto(file, caption) {
  if (!TOKEN) throw new Error('Thiếu FACEBOOK_PAGE_ACCESS_TOKEN');
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

const page = foodPageBlueprints().find(x => x.slot === PAGE_SLOT);
if (!page) throw new Error('Không tìm thấy blueprint Hôm Nay Ăn Gì?');

const recipe = pickRecipeForPage({ pageSlot:PAGE_SLOT, date:DATE, usedRecipeIds:[] });
const rendered = buildRecipePost({ page:{...page,name:PAGE_NAME}, recipe });
const image = await buildImage(recipe);
let caption = `${rendered.content}\n\n#HomNayAnGi`;
if (image.background) {
  caption += `\n\nẢnh nền: Wikimedia Commons (${image.background.license}).`;
}

const duplicate = await alreadyPosted({ recipeTitle:recipe.title });
let published = null;
let status = 'DRY_RUN';

if (duplicate) {
  status = 'ALREADY_POSTED';
} else if (PUBLISH) {
  published = await publishPhoto(image.path, caption);
  status = 'PUBLISHED';
}

const result = {
  status,
  publish_requested:PUBLISH,
  date:DATE,
  selected_hour_local:`${String(SELECTED_HOUR_VN).padStart(2,'0')}:00`,
  trigger_hour_local:TRIGGER_HOUR_VN == null ? null : `${String(TRIGGER_HOUR_VN).padStart(2,'0')}:00`,
  page:{ id:PAGE_ID, name:PAGE_NAME },
  recipe:{ id:recipe.id, title:recipe.title },
  image:{ path:image.path, has_public_domain_photo:Boolean(image.background), source:image.background?.sourceUrl || null, license:image.background?.license || null },
  duplicate,
  published,
  caption_preview:caption.slice(0,700)
};

fs.writeFileSync(path.join(outDir, `${DATE}-result.json`), JSON.stringify(result,null,2), 'utf8');
console.log('CLOUD_FOOD_RESULT='+JSON.stringify(result));
