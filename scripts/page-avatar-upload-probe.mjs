import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile=path.join(root,'data','facebook-browser-profile');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function dump(page,label){
  const scopes=page.locator('[role="dialog"],[role="menu"]');
  const n=await scopes.count().catch(()=>0);
  const out=[];
  for(let i=0;i<n;i++){
    const s=scopes.nth(i);
    if(!(await s.isVisible().catch(()=>false))) continue;
    out.push({
      role:await s.getAttribute('role').catch(()=>'' )||'',
      text:clean(await s.innerText().catch(()=>'' )).slice(0,2500),
      items:await s.locator('button,[role="button"],[role="menuitem"],a,input[type="file"]').evaluateAll(els=>els.map(el=>({
        tag:el.tagName,
        role:el.getAttribute('role')||'',
        aria:el.getAttribute('aria-label')||'',
        text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,180),
        type:el.getAttribute('type')||'',
        accept:el.getAttribute('accept')||'',
        visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)
      })).filter(x=>x.visible&&(x.text||x.aria||x.type==='file')).slice(0,80))
    });
  }
  console.log(label+'_SCOPES='+JSON.stringify(out));

  const files=await page.locator('input[type="file"]').evaluateAll(els=>els.map((el,i)=>({
    i,
    accept:el.getAttribute('accept')||'',
    multiple:el.hasAttribute('multiple'),
    visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length),
    outer:el.outerHTML.slice(0,450)
  })));
  console.log(label+'_FILES='+JSON.stringify(files));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  const avatar=page.getByRole('button',{name:/Hành động với ảnh đại diện|Profile picture actions/i}).last();
  console.log('AVATAR3_ACTION_VISIBLE='+(await avatar.isVisible({timeout:2200}).catch(()=>false)));
  await avatar.click({timeout:3000});
  await sleep(700);

  const choose=page.getByRole('menuitem',{name:/Chọn ảnh đại diện|Choose profile picture/i}).last();
  console.log('AVATAR3_CHOOSE_VISIBLE='+(await choose.isVisible({timeout:1800}).catch(()=>false)));
  await choose.click({timeout:3000});
  await sleep(1600);

  await dump(page,'AVATAR3_AFTER_CHOOSE');
}finally{
  await ctx.close();
}
