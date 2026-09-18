import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile=path.join(root,'data','facebook-browser-profile');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function dumpVisible(page,label){
  const rows=await page.locator('button,[role="button"],a,input[type="file"]').evaluateAll(els=>els.map(el=>({
    tag:el.tagName,
    role:el.getAttribute('role')||'',
    aria:el.getAttribute('aria-label')||'',
    text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,180),
    accept:el.getAttribute('accept')||'',
    type:el.getAttribute('type')||'',
    visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)
  })).filter(x=>x.visible&&(x.text||x.aria||x.type==='file')).slice(-80));
  console.log(label+'='+JSON.stringify(rows));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,
  headless:false,
  viewport:{width:1440,height:980},
  locale:'vi-VN'
});

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  const cover=page.getByRole('button',{name:/Thêm ảnh bìa|Chỉnh sửa ảnh bìa|Add cover photo|Edit cover photo/i}).last();
  const coverVisible=await cover.isVisible({timeout:2200}).catch(()=>false);
  console.log('MEDIA_COVER_CONTROL_VISIBLE='+coverVisible);
  if(coverVisible){
    await cover.click({timeout:3000});
    await sleep(1000);
    await dumpVisible(page,'MEDIA_COVER_MENU');
    await page.keyboard.press('Escape').catch(()=>{});
    await sleep(500);
  }

  const avatar=page.getByRole('button',{name:/Hành động với ảnh đại diện|Profile picture actions/i}).last();
  const avatarVisible=await avatar.isVisible({timeout:2200}).catch(()=>false);
  console.log('MEDIA_AVATAR_CONTROL_VISIBLE='+avatarVisible);
  if(avatarVisible){
    await avatar.click({timeout:3000});
    await sleep(1000);
    await dumpVisible(page,'MEDIA_AVATAR_MENU');
    await page.keyboard.press('Escape').catch(()=>{});
    await sleep(500);
  }

  const files=await page.locator('input[type="file"]').evaluateAll(els=>els.map(el=>({
    accept:el.getAttribute('accept')||'',
    multiple:el.hasAttribute('multiple'),
    aria:el.getAttribute('aria-label')||'',
    visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)
  })));
  console.log('MEDIA_FILE_INPUTS='+JSON.stringify(files));
}finally{
  await ctx.close();
}
