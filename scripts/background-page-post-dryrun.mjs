import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enqueueOperatorJob, ensureOperatorSchema } from '../src/facebook-operator-core.js';
import { foodPageBlueprints, pickRecipeForPage, buildRecipePost } from '../src/food-network-core.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const db=new Database(path.join(root,'data','social-manager.db'));
db.pragma('journal_mode = WAL');
ensureOperatorSchema(db);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();

function tomorrowVN(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return new Date(Date.UTC(Number(m.year),Number(m.month)-1,Number(m.day)+1)).toISOString().slice(0,10);
}

async function imageFor(title){
  const wanted=norm(title).split(' ').filter(x=>x.length>=3);
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
    const r=await fetch(url,{headers:{'User-Agent':'Social-Manager-Background-DryRun/2.0'}});
    if(!r.ok) continue;
    const body=await r.json().catch(()=>({}));
    const pages=Object.values(body?.query?.pages||{}).sort((a,b)=>Number(a.index||999)-Number(b.index||999));
    for(const item of pages){
      const ii=item?.imageinfo?.[0];
      if(!ii||!/^image\/(jpeg|png|webp)$/i.test(String(ii.mime||''))) continue;
      const meta=ii.extmetadata||{};
      const license=clean(meta.LicenseShortName?.value||meta.UsageTerms?.value||'');
      if(!/(CC0|CC BY|Public domain|Public Domain)/i.test(license)) continue;
      const hay=norm(`${item.title||''} ${clean(meta.ImageDescription?.value||'')}`);
      if(wanted.length && !wanted.some(t=>hay.includes(t))) continue;
      return {url:ii.thumburl||ii.url||'',license,title:item.title||''};
    }
  }
  return null;
}

try{
  const cleanupAt=new Date().toISOString();
  db.prepare(`
    UPDATE facebook_operator_jobs
    SET status='CANCELLED',
        error='Superseded by newer background publishing dry-run',
        locked_at=NULL,
        updated_at=?
    WHERE id LIKE 'bg-page-post-dryrun-%'
      AND status IN ('WAITING_USER','NEEDS_REVIEW','FAILED','QUEUED','PROCESSING','EXTENSION_QUEUED')
  `).run(cleanupAt);

  const page=db.prepare("SELECT slot,name,status,page_url FROM food_network_pages WHERE status='ACTIVE' ORDER BY slot LIMIT 1").get();
  if(!page) throw new Error('Không có Page ACTIVE');

  const date=tomorrowVN();
  const blueprint=foodPageBlueprints().find(x=>x.slot===Number(page.slot))||page;
  const used=db.prepare('SELECT recipe_id FROM food_network_daily WHERE date=?').all(date).map(x=>Number(x.recipe_id));
  const recipe=pickRecipeForPage({pageSlot:page.slot,date,usedRecipeIds:used});
  const rendered=buildRecipePost({page:{...blueprint,...page},recipe});
  const image=await imageFor(recipe.title);
  if(!image?.url) throw new Error('Không tìm thấy ảnh hợp lệ cho dry-run');

  const id=`bg-page-post-dryrun-${Date.now()}`;
  enqueueOperatorJob(db,{
    id,
    action:'post_page',
    payload:{
      page_name:page.name,
      page_url:page.page_url,
      message:rendered.content,
      image_url:image.url,
      dedupe_marker:'__DRY_RUN_DO_NOT_DEDUPE__'+Date.now(),
      dry_run:true
    }
  });

  const deadline=Date.now()+95000;
  let row=null;
  while(Date.now()<deadline){
    row=db.prepare('SELECT id,action,status,result_json,error,attempts,updated_at FROM facebook_operator_jobs WHERE id=?').get(id);
    if(row && ['DONE','FAILED','WAITING_USER','NEEDS_REVIEW'].includes(row.status)) break;
    await sleep(1500);
  }
  if(!row) throw new Error('Không tìm thấy dry-run job');

  let result={};
  try{ result=JSON.parse(row.result_json||'{}'); }catch{}
  const out={
    job_id:id,
    status:row.status,
    attempts:Number(row.attempts||0),
    error:row.error||null,
    result,
    date,
    recipe:recipe.title,
    image:{title:image.title,license:image.license,url:image.url},
    published:false
  };
  console.log('BACKGROUND_PUBLISH_DRY_RUN='+JSON.stringify(out));
  process.exitCode=(row.status==='DONE'&&result?.dry_run===true&&result?.ready_to_post===true)?0:4;
}finally{
  db.close();
}
