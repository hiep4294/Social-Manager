import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { foodPageBlueprints, pickRecipeForPage, buildRecipePost, localDateInVietnam } from '../src/food-network-core.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const dataDir=path.join(root,'data');
const dbFile=path.join(dataDir,'social-manager.db');

function stripHtml(value=''){
  return String(value).replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim();
}
function normalized(value=''){
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
}
function tomorrowVietnam(){
  const now=new Date();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const d=new Date(Date.UTC(Number(m.year),Number(m.month)-1,Number(m.day)+1,0,0,0));
  return d.toISOString().slice(0,10);
}
function postMinute(slot){
  const start=660;
  const width=540;
  return Math.min(1439,start+(((Number(slot)-1)*37)%width));
}
function hhmm(minute){
  return String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
}
async function licensedImage(title){
  const wanted=normalized(title).split(' ').filter(x=>x.length>=3);
  for(const query of [`"${title}"`,title,`${title} món ăn`]){
    const url=new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action','query');
    url.searchParams.set('format','json');
    url.searchParams.set('generator','search');
    url.searchParams.set('gsrnamespace','6');
    url.searchParams.set('gsrlimit','12');
    url.searchParams.set('gsrsearch',query);
    url.searchParams.set('prop','imageinfo');
    url.searchParams.set('iiprop','url|mime|extmetadata');
    url.searchParams.set('iiurlwidth','1200');
    const response=await fetch(url,{headers:{'User-Agent':'Social-Manager-Preflight/2.0'}});
    if(!response.ok) continue;
    const body=await response.json().catch(()=>({}));
    const pages=Object.values(body?.query?.pages||{}).sort((a,b)=>Number(a.index||999)-Number(b.index||999));
    for(const item of pages){
      const ii=item?.imageinfo?.[0];
      if(!ii||!/^image\/(jpeg|png|webp)$/i.test(String(ii.mime||''))) continue;
      const meta=ii.extmetadata||{};
      const license=stripHtml(meta.LicenseShortName?.value||meta.UsageTerms?.value||'');
      if(!/(CC0|CC BY|Public domain|Public Domain)/i.test(license)) continue;
      const hay=normalized(`${item.title||''} ${meta.ImageDescription?.value||''}`);
      const relevance=wanted.filter(token=>hay.includes(token)).length;
      if(wanted.length&&relevance===0) continue;
      return {
        title:item.title||'',
        image_url:ii.thumburl||ii.url||'',
        source_url:ii.descriptionurl||ii.descriptionshorturl||'',
        license,
        relevance
      };
    }
  }
  return null;
}

const db=new Database(dbFile,{readonly:true,fileMustExist:true});
try{
  const tomorrow=tomorrowVietnam();
  const page=db.prepare("SELECT slot,name,status,page_url FROM food_network_pages WHERE status='ACTIVE' ORDER BY slot LIMIT 1").get();
  if(!page) throw new Error('Không có Page ACTIVE');

  const blueprint=foodPageBlueprints().find(x=>x.slot===Number(page.slot))||page;
  const used=db.prepare('SELECT recipe_id FROM food_network_daily WHERE date=?').all(tomorrow).map(x=>Number(x.recipe_id));
  const recipe=pickRecipeForPage({pageSlot:page.slot,date:tomorrow,usedRecipeIds:used});
  const rendered=buildRecipePost({page:{...blueprint,...page},recipe});
  const image=await licensedImage(recipe.title).catch(error=>({error:String(error?.message||error)}));

  const quick=db.pragma('quick_check');
  const dbOk=Array.isArray(quick)&&quick.every(row=>Object.values(row).some(v=>String(v).toLowerCase()==='ok'));
  const unresolved=db.prepare("SELECT id,action,status,error FROM facebook_operator_jobs WHERE status IN ('WAITING_USER','NEEDS_REVIEW','FAILED','PROCESSING') ORDER BY updated_at DESC LIMIT 20").all();
  const marker=fs.existsSync(path.join(dataDir,'food-network-auto.enabled'));
  const operatorStatus=(()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'public','facebook-operator-status.json'),'utf8'));}catch{return null;}})();
  const supervisor=(()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'public','supervisor-health.json'),'utf8'));}catch{return null;}})();

  const result={
    today:localDateInVietnam(),
    tomorrow,
    page,
    post_time_local:hhmm(postMinute(page.slot)),
    recipe:{id:recipe.id,title:recipe.title},
    content_preview:rendered.content.slice(0,500),
    image,
    marker_enabled:marker,
    db_quick_check:dbOk?'ok':quick,
    unresolved_jobs:unresolved,
    operator:{
      headless:operatorStatus?.headless,
      profile_dir:operatorStatus?.profile_dir,
      queue:operatorStatus?.queue,
      status:operatorStatus?.status
    },
    supervisor:{
      online:supervisor?.online,
      crash_count_10m:supervisor?.crash_count_10m,
      status:supervisor?.status
    },
    will_publish:false,
    note:'Preflight only; no Facebook post was created.'
  };
  console.log('FOOD_PREFLIGHT='+JSON.stringify(result));
  process.exitCode=(marker&&dbOk&&page.status==='ACTIVE'&&image?.image_url)?0:4;
}finally{
  db.close();
}
