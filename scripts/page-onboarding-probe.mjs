import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const profile=path.join(root,'data','facebook-browser-profile-bg');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function visibleControls(scope,limit=100){
  const out=[];
  const nodes=scope.locator('button,[role="button"],a,input,textarea,[role="textbox"],[role="menuitem"],[role="option"]');
  const n=Math.min(await nodes.count().catch(()=>0),400);
  for(let i=0;i<n&&out.length<limit;i++){
    const el=nodes.nth(i);
    if(!(await el.isVisible().catch(()=>false))) continue;
    const row={
      tag:await el.evaluate(e=>e.tagName).catch(()=>'' ),
      role:await el.getAttribute('role').catch(()=>'' )||'',
      aria:await el.getAttribute('aria-label').catch(()=>'' )||'',
      placeholder:await el.getAttribute('placeholder').catch(()=>'' )||'',
      text:clean(await el.innerText().catch(()=>'' )).slice(0,220),
      href:await el.getAttribute('href').catch(()=>'' )||'',
      value:await el.inputValue().catch(()=>'' )
    };
    if(row.text||row.aria||row.placeholder||row.href||row.value) out.push(row);
  }
  return out;
}

async function dumpDialogs(page,label){
  const ds=page.locator('[role="dialog"],[role="menu"]');
  const count=await ds.count().catch(()=>0);
  const out=[];
  for(let i=0;i<count;i++){
    const d=ds.nth(i);
    if(!(await d.isVisible().catch(()=>false))) continue;
    out.push({
      role:await d.getAttribute('role').catch(()=>'' )||'',
      text:clean(await d.innerText().catch(()=>'' )).slice(0,2800),
      controls:await visibleControls(d,80)
    });
  }
  console.log(label+'='+JSON.stringify(out));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:true,viewport:{width:1440,height:980},locale:'vi-VN',
  args:['--no-sandbox','--disable-dev-shm-usage']
});

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3800);

  const body=clean(await page.locator('body').innerText().catch(()=>'' ));
  console.log('ONBOARD_PAGE_OK='+(/Công cụ chuyên nghiệp|Professional dashboard/i.test(body)));
  console.log('ONBOARD_CURRENT_URL='+page.url());

  // CTA probe.
  const cta=page.getByRole('button',{name:/^Thêm nút hành động$|^Add action button$/i}).first();
  const ctaVisible=await cta.isVisible({timeout:1800}).catch(()=>false);
  console.log('ONBOARD_CTA_VISIBLE='+ctaVisible);
  if(ctaVisible){
    await cta.click({timeout:3000});
    await sleep(1300);
    await dumpDialogs(page,'ONBOARD_CTA_DIALOG');
    await page.keyboard.press('Escape').catch(()=>{});
    await sleep(400);
  }

  // Username/settings probe.
  const u=new URL(page.url());
  const id=u.searchParams.get('id')||'61594459680780';
  const settingsUrls=[
    'https://www.facebook.com/profile.php?id='+encodeURIComponent(id)+'&sk=about',
    'https://www.facebook.com/settings/?tab=profile'
  ];
  for(let idx=0;idx<settingsUrls.length;idx++){
    await page.goto(settingsUrls[idx],{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    await sleep(2600);
    const text=clean(await page.locator('body').innerText().catch(()=>'' ));
    const controls=await visibleControls(page,120);
    const hits=controls.filter(x=>/tên người dùng|username|user name/i.test([x.text,x.aria,x.placeholder,x.href].join(' ')));
    console.log('ONBOARD_USERNAME_PAGE_'+idx+'='+JSON.stringify({
      url:page.url(),
      text:text.match(/.{0,120}(tên người dùng|username).{0,240}/i)?.[0]||'',
      hits:hits.slice(0,20)
    }));
  }

  // Surface unresolved operator jobs so onboarding does not leave hidden blockers.
  const dbFile=path.join(root,'data','social-manager.db');
  if(fs.existsSync(dbFile)){
    const db=new Database(dbFile,{readonly:true,fileMustExist:true});
    try{
      const rows=db.prepare(`
        SELECT id,action,status,error,created_at,updated_at
        FROM facebook_operator_jobs
        WHERE status IN ('WAITING_USER','NEEDS_REVIEW','FAILED')
        ORDER BY updated_at DESC
        LIMIT 10
      `).all();
      console.log('ONBOARD_PENDING_JOBS='+JSON.stringify(rows));
    }finally{db.close();}
  }
}finally{
  await ctx.close();
}
