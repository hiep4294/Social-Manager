import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { foodRecipes, pickRecipeForPage } from '../src/food-network-core.js';

const root = path.resolve(process.cwd());
const configPath = path.join(root, 'config', 'food-local-pages.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function nowIso() {
  return new Date().toISOString();
}

function vnDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Ho_Chi_Minh',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function defaultFoodImageRoot() {
  const base = process.env.OneDrive
    ? path.join(process.env.OneDrive, 'Documents')
    : path.join(process.env.USERPROFILE || os.homedir(), 'Documents');
  return path.join(base, 'anh-mon-an');
}

function safeJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

const requestedKey = String(process.argv[2] || 'hom-nay-an-gi').trim();
const page = (config.pages || []).find(x => x.page_key === requestedKey);

if (!page) {
  throw new Error(`Không tìm thấy page_key=${requestedKey}`);
}
if (!page.enabled) {
  throw new Error(`Page ${requestedKey} đang disabled`);
}
if (config.publish?.enabled !== true) {
  throw new Error('publish.enabled chưa bật');
}

const date = vnDate();
const imageRoot = path.resolve(process.env.FOOD_IMAGE_ROOT || defaultFoodImageRoot());
const stateDir = path.join(imageRoot, '_system', 'state');
const jobDir = path.join(imageRoot, '_system', 'jobs');
fs.mkdirSync(stateDir, { recursive:true });
fs.mkdirSync(jobDir, { recursive:true });

const statePath = path.join(stateDir, `${page.page_key}.json`);
const jobPath = path.join(jobDir, `${date}-${page.page_key}.json`);
const state = safeJson(statePath, { recipes:[], last_post_date:null });

if (String(state?.last_post_date || '') === date) {
  console.log('FOOD_POST_NOW=SKIP_ALREADY_POSTED_TODAY');
  console.log(`DATE=${date}`);
  console.log(`PAGE=${page.page_name}`);
  process.exit(0);
}

const existing = safeJson(jobPath);
if (existing && existing.status !== 'SKIPPED_LATE') {
  console.log('FOOD_POST_NOW=EXISTING_JOB');
  console.log(`JOB_STATUS=${existing.status || 'UNKNOWN'}`);
  console.log(`JOB_FILE=${jobPath}`);
  process.exit(0);
}

if (existing?.status === 'SKIPPED_LATE') {
  const archived = `${jobPath}.skipped-late-${Date.now()}.bak`;
  fs.renameSync(jobPath, archived);
  console.log(`ARCHIVED_SKIPPED_LATE=${archived}`);
}

const usedRecipeIds = (state?.recipes || [])
  .filter(x => x?.used)
  .map(x => Number(x.id))
  .filter(Number.isFinite);

const recipe = pickRecipeForPage({
  pageSlot:Number(page.page_slot),
  date,
  usedRecipeIds
});

if (!recipe) throw new Error('Không chọn được món để đăng');

const now = new Date();
const deadline = new Date(now.getTime() + 6 * 60 * 60 * 1000);
const code = `RID${String(Number(recipe.id)).padStart(3, '0')}`;

const job = {
  version:1,
  id:`food-${date}-${page.page_key}-manual-${Date.now()}`,
  date,
  page:{
    id:String(page.page_id),
    key:page.page_key,
    name:page.page_name
  },
  recipe:{
    id:Number(recipe.id),
    code,
    title:recipe.title
  },
  scheduled_at:now.toISOString(),
  deadline_at:deadline.toISOString(),
  manual_run:true,
  status:'SCHEDULED',
  image_attempts:0,
  image_job_id:null,
  post_job_id:null,
  final_path:null,
  created_at:nowIso(),
  updated_at:nowIso()
};

fs.writeFileSync(jobPath, JSON.stringify(job, null, 2) + '\n', 'utf8');

console.log('FOOD_POST_NOW=QUEUED');
console.log(`DATE=${date}`);
console.log(`PAGE=${page.page_name}`);
console.log(`RECIPE_ID=${recipe.id}`);
console.log(`RECIPE_TITLE=${recipe.title}`);
console.log(`JOB_FILE=${jobPath}`);
console.log('PIPELINE=CHATGPT_POSTER_TO_FACEBOOK');
