import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile=path.join(root,'data','facebook-browser-profile');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function dumpMenus(page,label){
  const menus=page.locator('[role="menu"],[role="dialog"]');
  const n=await menus.count().catch(()=>0);
  const out=[];
  for(let i=0;i<n;i++){
    const m=menus.nth(i);
    if(!(await m.isVisible().catch(()=>false))) continue;
    out.push({
      role:await m.getAttribute('role').catch(()=>'' )||'',
      text:clean(await m.innerText().catch(()=>'' )).slice(0,1800),
      items:await m.locator('[role="menuitem"],button,[role="button"],a').evaluateAll(els=>els.map(el=>({
        tag:el.tagName,
        role:el.getAttribute('role')||'',
        aria:el.getAttribute('aria-label')||'',
        text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,180)
      })).filter(x=>x.text||x.aria).slice(0,40))
    });
  }
  console.log(label+'_MENUS='+JSON.stringify(out));
}

async function dumpFiles(page,label){
  const rows=await page.locator('input[type="file"]').evaluateAll(els=>els.map((el,i)=>({
    i,
    accept:el.getAttribute('accept')||'',
    multiple:el.hasAttribute('multiple'),
    aria:el.getAttribute('aria-label')||'',
    name:el.getAttribute('name')||'',
    visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length),
    outer:el.outerHTML.slice(0,500)
  })));
  console.log(label+'_FILES='+JSON.stringify(rows));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  await dumpFiles(page,'MEDIA_BASE');

  const cover=page.getByRole('button',{name:/Thêm ảnh bìa|Chỉnh sửa ảnh bìa|Add cover photo|Edit cover photo/i}).last();
  console.log('MEDIA2_COVER_VISIBLE='+(await cover.isVisible({timeout:2200}).catch(()=>false)));
  if(await cover.isVisible({timeout:500}).catch(()=>false)){
    await cover.click({timeout:3000});
    await sleep(900);
    await dumpMenus(page,'MEDIA2_COVER');
    await dumpFiles(page,'MEDIA2_COVER');
    await page.keyboard.press('Escape').catch(()=>{});
    await sleep(500);
  }

  const avatar=page.getByRole('button',{name:/Hành động với ảnh đại diện|Profile picture actions/i}).last();
  console.log('MEDIA2_AVATAR_VISIBLE='+(await avatar.isVisible({timeout:2200}).catch(()=>false)));
  if(await avatar.isVisible({timeout:500}).catch(()=>false)){
    await avatar.click({timeout:3000});
    await sleep(900);
    await dumpMenus(page,'MEDIA2_AVATAR');
    await dumpFiles(page,'MEDIA2_AVATAR');
    await page.keyboard.press('Escape').catch(()=>{});
  }
}finally{
  await ctx.close();
}
