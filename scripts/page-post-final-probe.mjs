import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile=path.join(root,'data','facebook-browser-profile');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function dumpClickable(scope,label){
  const rows=await scope.locator('button,[role="button"],a,[tabindex="0"],input[type="submit"]').evaluateAll(els=>els.map(el=>({
    tag:el.tagName,
    role:el.getAttribute('role')||'',
    aria:el.getAttribute('aria-label')||'',
    title:el.getAttribute('title')||'',
    text:(el.innerText||el.textContent||el.value||'').replace(/\s+/g,' ').trim().slice(0,180),
    disabled:!!el.disabled || el.getAttribute('aria-disabled')==='true',
    tabindex:el.getAttribute('tabindex')||''
  })).filter(x=>x.text||x.aria||x.title).slice(0,80));
  console.log(label+'='+JSON.stringify(rows));
}
async function dumpFields(scope,label){
  const rows=await scope.locator('textarea,[contenteditable="true"],[role="textbox"],input').evaluateAll(els=>els.map(el=>({
    tag:el.tagName,
    role:el.getAttribute('role')||'',
    aria:el.getAttribute('aria-label')||'',
    placeholder:el.getAttribute('placeholder')||'',
    contenteditable:el.getAttribute('contenteditable')||'',
    value:el.value||'',
    text:(el.innerText||'').slice(0,500)
  })).slice(0,50));
  console.log(label+'='+JSON.stringify(rows));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});
try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  let trigger=page.getByRole('button',{name:/^bạn đang nghĩ gì\?$|^what.?s on your mind\??$/i}).first();
  if(!(await trigger.isVisible({timeout:2500}).catch(()=>false))){
    trigger=page.locator('[role="button"]').filter({hasText:/Bạn đang nghĩ gì/}).first();
  }
  console.log('POST_PROBE_TRIGGER='+(await trigger.isVisible({timeout:2000}).catch(()=>false)));
  await trigger.click({timeout:3000});
  await sleep(2200);

  let dialog=page.locator('[role="dialog"]').filter({hasText:/Tạo bài viết|Create post/i}).last();
  if(!(await dialog.isVisible({timeout:2500}).catch(()=>false))) dialog=page.locator('[role="dialog"]').last();

  console.log('POST_PROBE_DIALOG_VISIBLE='+(await dialog.isVisible({timeout:2000}).catch(()=>false)));
  console.log('POST_PROBE_DIALOG_TEXT='+JSON.stringify(clean(await dialog.innerText().catch(()=>'' )).slice(0,2600)));
  await dumpFields(dialog,'POST_PROBE_FIELDS_BEFORE');
  await dumpClickable(dialog,'POST_PROBE_BUTTONS_BEFORE');

  let editor=dialog.getByRole('textbox').last();
  if(!(await editor.isVisible({timeout:2000}).catch(()=>false))) editor=dialog.locator('[contenteditable="true"],textarea').last();

  if(await editor.isVisible({timeout:2000}).catch(()=>false)){
    await editor.click();
    await editor.fill('KODS_POST_PROBE_TEXT').catch(async()=>{
      await page.keyboard.press('Control+A').catch(()=>{});
      await page.keyboard.insertText('KODS_POST_PROBE_TEXT');
    });
    await sleep(1800);
    console.log('POST_PROBE_AFTER_FILL_TEXT='+JSON.stringify(clean(await dialog.innerText().catch(()=>'' )).slice(0,2600)));
    await dumpFields(dialog,'POST_PROBE_FIELDS_AFTER');
    await dumpClickable(dialog,'POST_PROBE_BUTTONS_AFTER');
    await page.keyboard.press('Control+A').catch(()=>{});
    await page.keyboard.press('Backspace').catch(()=>{});
  }
}finally{
  await ctx.close();
}
