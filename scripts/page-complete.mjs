import 'dotenv/config';
import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const target = String(process.argv[2] || '').trim();
if (!target) throw new Error('Usage: node scripts/page-complete.mjs <facebook-page-url>');

function clean(s){ return String(s||'').replace(/\s+/g,' ').trim(); }

function managedPageNameFromText(text){
  const s=clean(text);
  const patterns=[
    /Quản lý trang\s+(.+?)\s+(?:Công cụ chuyên nghiệp|Bảng điều khiển|Thông tin chi tiết)/i,
    /Chuyển sang Trang của (.+?) để /i,
    /Switch into (.+?) to /i,
    /Switch to (.+?) to /i
  ];
  for(const p of patterns){
    const m=s.match(p);
    if(m?.[1]) return clean(m[1]);
  }
  return '';
}

async function switchToManagedPage(page){
  const before=clean(await page.locator('body').innerText().catch(()=>'' ));
  const pageName=managedPageNameFromText(before);
  const hasSwitchPrompt=/Chuyển sang Trang của|Switch into|Switch to/i.test(before);
  const looksLikeActivePage=/Công cụ chuyên nghiệp|Professional dashboard/i.test(before)
    && /Chỉnh sửa|Edit/i.test(before);

  // If the Page management UI is already active, do not try to switch again.
  if(!hasSwitchPrompt && looksLikeActivePage){
    return {needed:false,switched:false,page_name:pageName||'',already_active:true};
  }

  // No explicit switch prompt means there is nothing to switch.
  if(!hasSwitchPrompt){
    return {needed:false,switched:false,page_name:pageName||'',already_active:false};
  }

  const clicked=await clickFirst(page,[
    p=>p.getByRole('button',{name:/^chuyển ngay$|^switch now$|^switch$/i}),
    p=>p.getByText(/^chuyển ngay$|^switch now$|^switch$/i),
    p=>p.getByText(/chuyển sang trang của|switch into|switch to/i)
  ],4500);

  if(!clicked) return {needed:true,switched:false,page_name:pageName,error:'Không tìm thấy nút Chuyển ngay'};

  await sleep(1200);
  await clickFirst(page,[
    p=>p.getByRole('button',{name:/^chuyển$|^switch$|^tiếp tục$|^continue$/i}),
    p=>p.getByText(/^chuyển$|^switch$|^tiếp tục$|^continue$/i)
  ],1800);

  await sleep(3500);
  await checkpoint(page);
  const after=clean(await page.locator('body').innerText().catch(()=>'' ));
  const stillPrompt=/Chuyển sang Trang của|Switch into|Switch to/i.test(after);
  return {needed:true,switched:!stillPrompt,page_name:pageName,error:stillPrompt?'Facebook vẫn đang yêu cầu chuyển sang Page':null};
}
async function checkpoint(page){
  const url = page.url().toLowerCase();
  const cookies = await page.context().cookies('https://www.facebook.com/').catch(()=>[]);
  const hasUserCookie = cookies.some(x => x.name === 'c_user' && String(x.value || '').trim());
  if (/\/checkpoint|\/two_factor/.test(url)) {
    const e = new Error('Facebook yêu cầu checkpoint/2FA tại ' + page.url()); e.code='WAITING_USER'; throw e;
  }
  if (/\/login/.test(url) && !hasUserCookie) {
    const e = new Error('Facebook yêu cầu đăng nhập tại ' + page.url()); e.code='WAITING_USER'; throw e;
  }
  if (!hasUserCookie) {
    const probes = page.locator('input[name="email"],input[name="pass"],iframe[src*="captcha"],[data-testid*="captcha"]');
    const n = await probes.count().catch(()=>0);
    let visibleSecurity = false;
    for (let i=0; i<n; i++) {
      if (await probes.nth(i).isVisible().catch(()=>false)) { visibleSecurity = true; break; }
    }
    if (visibleSecurity) {
      const e = new Error('Facebook chưa có phiên đăng nhập hợp lệ'); e.code='WAITING_USER'; throw e;
    }
  }
}
async function clickFirst(page, list, timeout=2500){
  for (const f of list) try {
    const l = typeof f === 'string' ? page.locator(f) : f(page);
    if (await l.first().isVisible({timeout})) { await l.first().click({timeout}); return true; }
  } catch {}
  return false;
}
async function fillFirst(page, list, value, timeout=2500){
  for (const f of list) try {
    const l = typeof f === 'string' ? page.locator(f) : f(page);
    if (await l.first().isVisible({timeout})) { await l.first().fill(String(value),{timeout}); return true; }
  } catch {}
  return false;
}

async function clickTextOrAncestor(page, pattern, timeout=2500){
  const text=page.getByText(pattern).first();
  try {
    if(!(await text.isVisible({timeout}))) return false;
    const ancestor=text.locator('xpath=ancestor::*[@role="button" or self::button or self::a][1]');
    if(await ancestor.count()){
      await ancestor.click({timeout});
      return true;
    }
    await text.click({timeout});
    return true;
  } catch {}
  return false;
}

async function clickNearbyEdit(page, labels, timeout=2500){
  for(const label of labels){
    const hits=page.getByText(label,{exact:true});
    const count=Math.min(await hits.count().catch(()=>0),8);
    for(let i=0;i<count;i++){
      const hit=hits.nth(i);
      if(!(await hit.isVisible().catch(()=>false))) continue;
      for(let depth=1;depth<=7;depth++){
        const box=hit.locator('xpath='+'../'.repeat(depth));
        const edit=box.getByText(/^(Chỉnh sửa|Edit)$/i,{exact:true}).last();
        if(await edit.isVisible({timeout:300}).catch(()=>false)){
          try{ await edit.click({timeout}); return {ok:true,label,depth}; }catch{}
        }
        const editBtn=box.locator('button,[role="button"],a').filter({hasText:/^\s*(Chỉnh sửa|Edit)\s*$/i}).last();
        if(await editBtn.isVisible({timeout:300}).catch(()=>false)){
          try{ await editBtn.click({timeout}); return {ok:true,label,depth}; }catch{}
        }
      }
    }
  }
  return {ok:false};
}

async function fillOpenEditor(page, value){
  const dialog=page.locator('[role="dialog"]').last();
  let editor=dialog.locator('[role="textbox"],textarea,[contenteditable="true"]').first();
  if(!(await editor.isVisible({timeout:1800}).catch(()=>false))){
    editor=page.locator('[role="textbox"],textarea,[contenteditable="true"]').filter({hasNotText:/tìm kiếm|search/i}).last();
  }
  if(!(await editor.isVisible({timeout:1800}).catch(()=>false))) return false;
  await editor.click();
  try{ await editor.fill(value); }
  catch{
    await page.keyboard.press('Control+A').catch(()=>{});
    await page.keyboard.insertText(value);
  }
  return true;
}

async function saveOpenEditor(page){
  return await clickFirst(page,[
    p=>p.getByRole('button',{name:/^(lưu|save|xong|done)$/i}),
    p=>p.getByText(/^(lưu|save|xong|done)$/i)
  ],3000);
}

async function visibleControls(page, limit=40){
  const out=[];
  const nodes=page.locator('button,[role="button"],a,input,textarea,[contenteditable="true"]');
  const n=Math.min(await nodes.count().catch(()=>0),200);
  for(let i=0;i<n && out.length<limit;i++){
    const el=nodes.nth(i);
    if(!(await el.isVisible().catch(()=>false))) continue;
    const text=clean(await el.innerText().catch(()=>'' ) || await el.getAttribute('aria-label').catch(()=>'' ) || await el.getAttribute('placeholder').catch(()=>'' ));
    if(text) out.push(text.slice(0,140));
  }
  return [...new Set(out)];
}

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile = path.join(root,'data','facebook-browser-profile');
const browser = process.env.FB_OPERATOR_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ctx = await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});

const result = {target, page_profile:null, inspect:null, edit:{status:'SKIPPED',changed:[]}, post:{status:'SKIPPED'}};

try {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4500);
  await checkpoint(page);
  console.log('PAGE_CHECKPOINT_OK url='+page.url());

  const profileSwitch=await switchToManagedPage(page);
  result.page_profile=profileSwitch;
  console.log('PAGE_PROFILE='+JSON.stringify(profileSwitch));
  if(profileSwitch.needed && !profileSwitch.switched){
    const e=new Error(profileSwitch.error || 'Chưa chuyển được sang Page profile');
    e.code='NEEDS_REVIEW';
    throw e;
  }

  if(profileSwitch.switched){
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(3500);
    await checkpoint(page);
  }

  const resolved = page.url();
  const title = await page.title().catch(()=> '');
  const h1 = (await page.locator('h1').allTextContents().catch(()=>[])).map(clean).filter(Boolean);
  const bodyFull = clean(await page.locator('body').innerText().catch(()=>'' ));
  const body0 = bodyFull.slice(0,3500);
  const generic=/^(quản lý trang|manage page|facebook)$/i;
  const h1Name=h1.find(x=>!generic.test(x)) || '';
  const inferredName=managedPageNameFromText(bodyFull);
  const name = profileSwitch.page_name || inferredName || h1Name || clean(title.replace(/\s*[|·-]\s*Facebook\s*$/i,'')) || 'Bếp ngon mỗi ngày';
  result.inspect = {url:resolved,title,page_name:name,text:body0};

  const bio = 'Món ngon mỗi ngày • Công thức dễ làm • Mẹo bếp thực tế cho gia đình.';

  // Facebook current Page UI: "Chỉnh sửa" is a link that navigates to the About/Profile editor.
  let opened = await clickFirst(page,[
    p=>p.getByRole('link',{name:/chỉnh sửa trang cá nhân|edit profile/i}),
    'a[aria-label*="Chỉnh sửa trang cá nhân" i]',
    p=>p.getByText(/^chỉnh sửa$|^edit$/i)
  ],3500);

  if(opened){
    await sleep(1800);
    result.edit.opened=true;
    result.edit.edit_url=page.url();

    // Exact selector confirmed by live DOM probe: role=button, aria-label="Chỉnh sửa tiểu sử".
    const editPageText=clean(await page.locator('body').innerText().catch(()=>'' ));
    if(editPageText.includes(bio)){
      result.edit.bio_status='ALREADY_EXISTS';
    } else {
      const bioButton=page.getByRole('button',{name:/^chỉnh sửa tiểu sử$|^edit bio$/i}).first();
      const bioVisible=await bioButton.isVisible({timeout:2500}).catch(()=>false);
      result.edit.bio_click={ok:bioVisible,selector:'role=button aria=Chỉnh sửa tiểu sử'};

      if(bioVisible){
        await bioButton.click({timeout:3000});
        await sleep(900);
        result.edit.bio_controls_before_fill=await visibleControls(page,30);
        if(await fillOpenEditor(page,bio)){
          const saved=await saveOpenEditor(page);
          if(saved){
            result.edit.changed.push('bio');
            result.edit.bio_status='DONE';
            await sleep(1200);
          } else {
            // If the value is already present and Facebook disables/hides Save, treat it as idempotent success.
            const editorValue=clean(await page.locator('[role="dialog"] [role="textbox"],[role="dialog"] textarea,[role="dialog"] [contenteditable="true"]').last().innerText().catch(()=>'' ));
            if(editorValue.includes(bio)){
              result.edit.bio_status='ALREADY_EXISTS';
            } else {
              result.edit.bio_save='NOT_FOUND';
            }
          }
        } else {
          result.edit.bio_editor='NOT_FOUND';
        }
      }
    }

    // If Facebook exposes category as a direct editable field, update it; otherwise leave it for the next dedicated pass.
    const catField=page.getByRole('textbox',{name:/danh mục|category|hạng mục/i}).first();
    if(await catField.isVisible({timeout:800}).catch(()=>false)){
      await catField.fill('Food & beverage');
      await sleep(700);
      if(await clickFirst(page,[p=>p.getByRole('option').first(),'[role="option"]'],1200)){
        if(await saveOpenEditor(page)){
          result.edit.changed.push('category');
          await sleep(800);
        }
      }
    }

    result.edit.controls=await visibleControls(page,40);
    result.edit.status=(result.edit.changed.length || result.edit.bio_status==='ALREADY_EXISTS') ? 'DONE' : 'NEEDS_REVIEW';
  } else {
    result.edit.status='NEEDS_REVIEW';
    result.edit.controls=await visibleControls(page,40);
  }

  await page.goto(resolved,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3500);
  await checkpoint(page);

  const intro = `Chào mừng bạn đến với ${name}!\n\nTrang chia sẻ công thức dễ làm, gợi ý món ăn mỗi ngày và những mẹo bếp thực tế. Theo dõi trang để không bỏ lỡ các món mới.\n\n#MonNgonMoiNgay #CongThucNauAn #BepNha`;
  const currentText = clean(await page.locator('body').innerText().catch(()=>'' ));

  if (currentText.includes('Trang chia sẻ công thức dễ làm')) {
    result.post.status='ALREADY_EXISTS';
  } else {
    let openedPost = await clickFirst(page,[
      p=>p.getByRole('button',{name:/^bạn đang nghĩ gì\?$|^what.?s on your mind\??$/i}),
      '[role="button"]:has-text("Bạn đang nghĩ gì?")',
      '[role="button"]:has-text("Chia sẻ suy nghĩ")',
      '[role="button"]:has-text("Tạo bài viết")'
    ],3500);
    if(!openedPost) openedPost=await clickTextOrAncestor(page,/chia sẻ suy nghĩ|bạn đang nghĩ gì|create a post|what.?s on your mind/i,3000);
    result.post.opened=openedPost;

    if (!openedPost) result.post.status='NEEDS_REVIEW';
    else {
      // Facebook composer can take a few seconds to mount after the trigger click.
      await sleep(1800);

      let dialog=page.locator('[role="dialog"]').filter({hasText:/Tạo bài viết|Create post/i}).last();
      if(!(await dialog.isVisible({timeout:5000}).catch(()=>false))){
        dialog=page.locator('[role="dialog"]').last();
      }
      result.post.dialog_visible=await dialog.isVisible({timeout:2500}).catch(()=>false);

      let editor=dialog.getByRole('textbox').last();
      if(!(await editor.isVisible({timeout:3000}).catch(()=>false))){
        editor=dialog.locator('[contenteditable="true"],textarea').last();
      }
      if(!(await editor.isVisible({timeout:2000}).catch(()=>false))){
        editor=page.locator('[role="textbox"][contenteditable="true"],[contenteditable="true"][data-lexical-editor="true"],textarea').last();
      }

      if (await editor.isVisible({timeout:3000}).catch(()=>false)) {
        result.post.editor_found=true;
        await editor.click();
        try {
          await editor.fill(intro);
        } catch {
          await page.keyboard.press('Control+A').catch(()=>{});
          await page.keyboard.insertText(intro);
        }

        await sleep(1400);

        // Current Facebook flow is two-step: enter text -> "Tiếp" -> "Đăng".
        let nextButton=dialog.getByRole('button',{name:/^(Tiếp|Next)$/i}).last();
        if(!(await nextButton.isVisible({timeout:2500}).catch(()=>false))){
          nextButton=page.getByRole('button',{name:/^(Tiếp|Next)$/i}).last();
        }

        result.post.next_button_visible=await nextButton.isVisible({timeout:2500}).catch(()=>false);
        if(result.post.next_button_visible){
          for(let i=0;i<8;i++){
            result.post.next_button_enabled=await nextButton.isEnabled().catch(()=>false);
            if(result.post.next_button_enabled) break;
            await sleep(500);
          }
          if(result.post.next_button_enabled){
            await nextButton.click({timeout:4000});
            await sleep(2200);
            dialog=page.locator('[role="dialog"]').last();
          }
        }

        let postButton=dialog.getByRole('button',{name:/^(Đăng|Post)$/i}).last();
        if(!(await postButton.isVisible({timeout:3500}).catch(()=>false))){
          postButton=page.getByRole('button',{name:/^(Đăng|Post)$/i}).last();
        }

        result.post.post_button_visible=await postButton.isVisible({timeout:2500}).catch(()=>false);
        result.post.post_button_enabled=result.post.post_button_visible
          ? await postButton.isEnabled().catch(()=>false)
          : false;

        if(result.post.post_button_visible && result.post.post_button_enabled){
          await postButton.click({timeout:4000});
          await sleep(5000);
          await checkpoint(page);

          // Reload before verification so success is not inferred from text still inside the composer.
          await page.goto(resolved,{waitUntil:'domcontentloaded',timeout:30000});
          await sleep(3500);
          const verifyText=clean(await page.locator('body').innerText().catch(()=>'' ));
          result.post.verified=verifyText.includes('Trang chia sẻ công thức dễ làm');
          result.post.status=result.post.verified ? 'DONE' : 'NEEDS_REVIEW';
        } else {
          result.post.status='NEEDS_REVIEW';
          result.post.dialog_text=clean(await dialog.innerText().catch(()=>'' )).slice(0,1800);
          result.post.controls=await visibleControls(page,80);
        }
      } else {
        result.post.editor_found=false;
        result.post.status='NEEDS_REVIEW';
        result.post.dialog_text=clean(await dialog.innerText().catch(()=>'' )).slice(0,1800);
        result.post.controls=await visibleControls(page,60);
      }
    }
  }

  console.log('PAGE_COMPLETE_RESULT='+JSON.stringify(result));
  const okEdit=result.edit.status==='DONE';
  const okPost=['DONE','ALREADY_EXISTS'].includes(result.post.status);
  if(!okEdit || !okPost) process.exitCode=4;
} finally {
  await ctx.close();
}