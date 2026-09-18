import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=String(process.argv[2]||'https://www.facebook.com/share/18LofHUx56/?mibextid=wwXIfr').trim();
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile=path.join(root,'data','facebook-browser-profile');
const browser=process.env.FB_OPERATOR_BROWSER_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();

async function dumpScope(scope,label){
  console.log(label+'_TEXT='+JSON.stringify(clean(await scope.innerText().catch(()=>'' )).slice(0,3000)));
  const buttons=await scope.locator('button,[role="button"],a,[tabindex="0"]').evaluateAll(els=>els.map(el=>({
    tag:el.tagName,
    role:el.getAttribute('role')||'',
    aria:el.getAttribute('aria-label')||'',
    title:el.getAttribute('title')||'',
    text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,180),
    disabled:!!el.disabled||el.getAttribute('aria-disabled')==='true',
    visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)
  })).filter(x=>x.visible&&(x.text||x.aria||x.title)).slice(0,100));
  console.log(label+'_BUTTONS='+JSON.stringify(buttons));
}

const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});

try{
  const page=ctx.pages()[0]||await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4200);

  const u=new URL(page.url());
  const id=u.searchParams.get('id');
  if(!id) throw new Error('PAGE_ID_NOT_FOUND');

  const categoryUrl='https://www.facebook.com/profile.php?id='+encodeURIComponent(id)+'&sk=directory_category';
  await page.goto(categoryUrl,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3200);

  const current=page.getByText(/Blog cá nhân|Personal blog/i,{exact:true}).first();
  const section=current.locator('xpath=ancestor::section[1]');
  let edit=section.getByRole('button',{name:/chỉnh sửa|edit/i}).last();
  if(!(await edit.isVisible({timeout:1800}).catch(()=>false))){
    edit=page.locator('[role="button"][aria-label*="Hạng mục" i], [role="button"][aria-label*="danh mục" i]').first();
  }
  console.log('CAT_PROBE_EDIT_VISIBLE='+(await edit.isVisible({timeout:1800}).catch(()=>false)));
  await edit.click({timeout:3000});
  await sleep(1400);

  let dialog=page.locator('[role="dialog"]').last();
  console.log('CAT_PROBE_DIALOG_VISIBLE='+(await dialog.isVisible({timeout:1800}).catch(()=>false)));
  await dumpScope(dialog,'CAT_PROBE_BEFORE');

  let box=dialog.getByRole('combobox').last();
  if(!(await box.isVisible({timeout:1800}).catch(()=>false))) box=dialog.getByRole('textbox').last();
  if(!(await box.isVisible({timeout:1800}).catch(()=>false))) box=page.getByRole('combobox').last();

  console.log('CAT_PROBE_EDITOR_VISIBLE='+(await box.isVisible({timeout:1800}).catch(()=>false)));
  await box.fill('Nhà bếp/Nấu ăn');
  await sleep(1300);

  const opts=page.getByRole('option');
  const count=await opts.count().catch(()=>0);
  const vals=[];
  for(let i=0;i<Math.min(count,20);i++){
    const o=opts.nth(i);
    if(await o.isVisible().catch(()=>false)) vals.push(clean(await o.innerText().catch(()=>'' )));
  }
  console.log('CAT_PROBE_OPTIONS='+JSON.stringify(vals));

  let opt=page.getByRole('option').filter({hasText:/Nhà bếp|Nấu ăn|Ẩm thực|Food|Kitchen/i}).first();
  if(await opt.isVisible({timeout:1800}).catch(()=>false)){
    console.log('CAT_PROBE_SELECT='+JSON.stringify(clean(await opt.innerText())));
    await opt.click();
    await sleep(1600);
  } else {
    console.log('CAT_PROBE_SELECT=NOT_FOUND');
  }

  dialog=page.locator('[role="dialog"]').last();
  await dumpScope(dialog,'CAT_PROBE_AFTER');
  console.log('CAT_PROBE_PAGE_TEXT='+JSON.stringify(clean(await page.locator('body').innerText().catch(()=>'' )).slice(-2500)));
} finally {
  await ctx.close();
}
