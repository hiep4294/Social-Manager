import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile=path.join(root,'data','facebook-browser-profile');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function dump(page,dialog,label){
  console.log(label+'_TEXT='+JSON.stringify(clean(await dialog.innerText().catch(()=>'' )).slice(0,3500)));
  const fields=await page.locator('textarea,[contenteditable="true"],[role="textbox"],input').evaluateAll(els=>els.map(el=>({
    tag:el.tagName,
    role:el.getAttribute('role')||'',
    aria:el.getAttribute('aria-label')||'',
    placeholder:el.getAttribute('placeholder')||'',
    contenteditable:el.getAttribute('contenteditable')||'',
    visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length),
    value:el.value||'',
    text:(el.innerText||'').slice(0,300)
  })).filter(x=>x.visible).slice(0,60));
  console.log(label+'_FIELDS='+JSON.stringify(fields));
  const btns=await page.locator('button,[role="button"],a,[tabindex="0"]').evaluateAll(els=>els.map(el=>({
    tag:el.tagName,
    role:el.getAttribute('role')||'',
    aria:el.getAttribute('aria-label')||'',
    title:el.getAttribute('title')||'',
    text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,200),
    visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length),
    disabled:!!el.disabled||el.getAttribute('aria-disabled')==='true'
  })).filter(x=>x.visible&&(x.text||x.aria||x.title)).slice(-80));
  console.log(label+'_BUTTONS='+JSON.stringify(btns));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});
try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4500);

  let trigger=page.getByRole('button',{name:/^bạn đang nghĩ gì\?$|^what.?s on your mind\??$/i}).first();
  if(!(await trigger.isVisible({timeout:2500}).catch(()=>false))){
    trigger=page.locator('[role="button"]').filter({hasText:/Bạn đang nghĩ gì/}).first();
  }
  console.log('LONG_PROBE_TRIGGER='+(await trigger.isVisible({timeout:2000}).catch(()=>false)));
  await trigger.click({timeout:3000});

  for(const ms of [1500,3500,7000,12000]){
    await sleep(ms===1500?1500:ms-(ms===3500?1500:ms===7000?3500:7000));
    let dialog=page.locator('[role="dialog"]').filter({hasText:/Tạo bài viết|Create post/i}).last();
    if(!(await dialog.isVisible({timeout:800}).catch(()=>false))) dialog=page.locator('[role="dialog"]').last();
    console.log('LONG_PROBE_T='+ms+'_DIALOG='+(await dialog.isVisible({timeout:800}).catch(()=>false)));
    await dump(page,dialog,'LONG_PROBE_T'+ms);
  }

  const frames=page.frames().map(f=>({url:f.url(),name:f.name()}));
  console.log('LONG_PROBE_FRAMES='+JSON.stringify(frames.slice(0,20)));
}finally{
  await ctx.close();
}
