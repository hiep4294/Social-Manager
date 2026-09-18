import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const dataDir=path.join(root,'data');
const source=path.join(dataDir,'facebook-browser-profile');
const target=path.join(dataDir,'facebook-browser-profile-bg');
const targetUrl=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function skipCopy(src){
  const b=path.basename(src);
  if (/^Singleton(Lock|Cookie|Socket)$/i.test(b)) return true;
  if (/^(Cache|Code Cache|GPUCache|ShaderCache|GrShaderCache|DawnCache|Crashpad|BrowserMetrics)$/i.test(b)) return true;
  if (/\.tmp$/i.test(b)) return true;
  return false;
}

if(!fs.existsSync(source)) throw new Error('Không tìm thấy profile Facebook nguồn: '+source);
if(!fs.existsSync(browser)) throw new Error('Không tìm thấy Chrome: '+browser);

fs.mkdirSync(dataDir,{recursive:true});
fs.rmSync(target,{recursive:true,force:true});
fs.cpSync(source,target,{recursive:true,filter:src=>!skipCopy(src)});

// Pause any Food Network jobs that may have been queued before background-safe mode was enabled.
const dbFile=path.join(dataDir,'social-manager.db');
let pausedJobs=0;
if(fs.existsSync(dbFile)){
  const db=new Database(dbFile);
  try{
    const now=new Date().toISOString();
    const r=db.prepare(`
      UPDATE facebook_operator_jobs
      SET status='NEEDS_REVIEW',
          error='Paused while current Page is being onboarded for background mode',
          locked_at=NULL,
          updated_at=?
      WHERE (id LIKE 'food-create-page-%' OR id LIKE 'food-post-%')
        AND status IN ('QUEUED','EXTENSION_QUEUED','PROCESSING')
    `).run(now);
    pausedJobs=Number(r.changes||0);
  }finally{ db.close(); }
}

const ctx=await chromium.launchPersistentContext(target,{
  executablePath:browser,
  headless:true,
  viewport:{width:1440,height:980},
  locale:'vi-VN',
  args:['--no-sandbox','--disable-dev-shm-usage']
});

let auth=false;
let pageOk=false;
let pageName='';
let finalUrl='';
try{
  const cookies=await ctx.cookies('https://www.facebook.com/').catch(()=>[]);
  auth=cookies.some(x=>x.name==='c_user'&&String(x.value||'').trim());
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(3200);
  finalUrl=page.url();
  const body=String(await page.locator('body').innerText().catch(()=>'')).replace(/\s+/g,' ').trim();
  const m=body.match(/Quản lý trang\s+(.+?)\s+(?:Công cụ chuyên nghiệp|Thông tin chi tiết)/i);
  pageName=m?.[1]?.trim()||'';
  pageOk=/Công cụ chuyên nghiệp|Professional dashboard/i.test(body)
    && !/Đăng nhập|Log in/i.test(body)
    && !/checkpoint|two-factor|mã xác nhận/i.test(body.toLowerCase());
}finally{
  await ctx.close();
}

const result={
  source,
  target,
  copied:true,
  paused_food_jobs:pausedJobs,
  authenticated:auth,
  page_ok:pageOk,
  page_name:pageName,
  final_url:finalUrl
};
fs.writeFileSync(path.join(dataDir,'background-agent-profile-status.json'),JSON.stringify(result,null,2),'utf8');
console.log('BACKGROUND_PROFILE_RESULT='+JSON.stringify(result));
process.exitCode=(auth&&pageOk)?0:4;
