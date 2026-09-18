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
  if(!pageName) return {needed:false,switched:false,page_name:''};

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

  const bio = `${name} – công thức dễ làm, món ngon mỗi ngày và mẹo bếp thực tế. Theo dõi trang để mỗi ngày có thêm một gợi ý cho bữa ăn.`;

  let opened = await clickFirst(page,[
    p=>p.getByRole('button',{name:/^chỉnh sửa$|^edit$/i}),
    p=>p.getByText(/^chỉnh sửa$|^edit$/i),
    p=>p.getByRole('button',{name:/edit page details|edit details|chỉnh sửa chi tiết trang|chỉnh sửa thông tin|chỉnh sửa thông tin trang/i}),
    p=>p.getByText(/edit page details|edit details|chỉnh sửa chi tiết trang|chỉnh sửa thông tin|chỉnh sửa thông tin trang/i)
  ],3500);

  if(!opened){
    const details=await clickFirst(page,[
      p=>p.getByText(/^thông tin chi tiết$|^details$|^page details$/i),
      p=>p.getByRole('link',{name:/thông tin chi tiết|details|page details/i}),
      'a[href*="about"]'
    ],3000);
    if(details){
      await sleep(1500);
      opened=await clickFirst(page,[
        p=>p.getByRole('button',{name:/edit|chỉnh sửa/i}),
        p=>p.getByText(/chỉnh sửa thông tin|edit details|edit page details/i)
      ],3000);
    }
  }

  if (opened) {
    await sleep(1500);
    result.edit.opened=true;
    result.edit.controls=await visibleControls(page,30);

    if (await fillFirst(page,[
      p=>p.getByLabel(/bio|tiểu sử|mô tả/i),
      'textarea[placeholder*="bio" i]',
      'textarea[placeholder*="mô tả" i]',
      'textarea',
      '[contenteditable="true"][aria-label*="tiểu sử" i]',
      '[contenteditable="true"][aria-label*="bio" i]'
    ],bio,3000)) result.edit.changed.push('bio');
    else {
      const bioRow=await clickFirst(page,[
        p=>p.getByText(/^gợi ý món mỗi ngày$/i),
        p=>p.getByText(/^tiểu sử$|^bio$|^mô tả$/i)
      ],1800);
      if(bioRow){
        await sleep(700);
        if(await fillFirst(page,[
          p=>p.getByRole('textbox'),
          'textarea',
          '[contenteditable="true"]'
        ],bio,2500)){
          result.edit.changed.push('bio');
          await clickFirst(page,[
            p=>p.getByRole('button',{name:/^(lưu|save|xong|done)$/i}),
            p=>p.getByText(/^(lưu|save|xong|done)$/i)
          ],2000);
          await sleep(700);
        }
      }
    }

    if(!result.edit.changed.includes('bio')){
      const clickedBio=await clickTextOrAncestor(page,/^gợi ý món mỗi ngày$/i,2200);
      if(clickedBio){
        await sleep(900);
        let editor=page.locator('[role="dialog"] [role="textbox"],[role="dialog"] textarea,[role="dialog"] [contenteditable="true"]').first();
        if(!(await editor.isVisible({timeout:1800}).catch(()=>false))) editor=page.getByRole('textbox').last();
        if(await editor.isVisible({timeout:1800}).catch(()=>false)){
          await editor.click();
          await page.keyboard.press('Control+A').catch(()=>{});
          await page.keyboard.insertText(bio);
          const saved=await clickFirst(page,[
            p=>p.getByRole('button',{name:/^(lưu|save|xong|done)$/i}),
            p=>p.getByText(/^(lưu|save|xong|done)$/i)
          ],2500);
          if(saved){result.edit.changed.push('bio');await sleep(900);}
        }
      }
    }

    if (await fillFirst(page,[
      p=>p.getByLabel(/category|danh mục|hạng mục/i),
      'input[placeholder*="category" i]',
      'input[placeholder*="danh mục" i]',
      'input[placeholder*="hạng mục" i]'
    ],'Food & beverage',2200)) {
      await sleep(700);
      await clickFirst(page,[p=>p.getByRole('option').first(),'[role="option"]'],1500);
      result.edit.changed.push('category');
    } else {
      const catRow=await clickFirst(page,[
        p=>p.getByText(/^blog cá nhân$/i),
        p=>p.getByText(/^danh mục$|^category$|^hạng mục$/i)
      ],1600);
      if(catRow){
        await sleep(600);
        if(await fillFirst(page,[
          p=>p.getByRole('textbox'),
          'input[type="text"]'
        ],'Food & beverage',2200)){
          await sleep(700);
          if(await clickFirst(page,[p=>p.getByRole('option').first(),'[role="option"]'],1500)){
            result.edit.changed.push('category');
            await clickFirst(page,[
              p=>p.getByRole('button',{name:/^(lưu|save|xong|done)$/i}),
              p=>p.getByText(/^(lưu|save|xong|done)$/i)
            ],1800);
            await sleep(700);
          }
        }
      }
    }

    if (result.edit.changed.length) {
      const saved = await clickFirst(page,[
        p=>p.getByRole('button',{name:/^(save|lưu|done|xong)$/i}),
        'button:has-text("Save")','button:has-text("Lưu")'
      ],3500);
      result.edit.status = saved ? 'DONE' : 'NEEDS_REVIEW';
      await sleep(1800);
      await checkpoint(page);
    } else {
      result.edit.status='NEEDS_REVIEW';
      result.edit.controls=await visibleControls(page,40);
    }
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
      p=>p.getByRole('button',{name:/create a post|tạo bài viết|what.?s on your mind|bạn đang nghĩ gì|chia sẻ suy nghĩ/i}),
      '[role="button"]:has-text("Tạo bài viết")',
      '[role="button"]:has-text("Bạn đang nghĩ gì")',
      '[role="button"]:has-text("Chia sẻ suy nghĩ")'
    ],3500);
    if(!openedPost) openedPost=await clickTextOrAncestor(page,/bạn đang nghĩ gì|chia sẻ suy nghĩ|create a post|what.?s on your mind/i,3000);

    if (!openedPost) result.post.status='NEEDS_REVIEW';
    else {
      await sleep(900);
      const dialog = page.locator('[role="dialog"]').last();
      let editor = dialog.locator('[role="textbox"],[contenteditable="true"],textarea').first();
      if(!(await editor.isVisible({timeout:2500}).catch(()=>false))){
        editor=page.locator('[role="textbox"],[contenteditable="true"],textarea').filter({hasNotText:/tìm kiếm|search/i}).last();
      }
      if (await editor.isVisible({timeout:3000}).catch(()=>false)) {
        await editor.click();
        try { await editor.fill(intro); }
        catch {
          await page.keyboard.press('Control+A').catch(()=>{});
          await page.keyboard.insertText(intro);
        }
        await sleep(900);
        const posted = await clickFirst(page,[
          p=>p.getByRole('button',{name:/^(post|đăng)$/i}),
          p=>p.getByText(/^(post|đăng)$/i),
          '[role="dialog"] [role="button"]:has-text("Đăng")',
          '[role="dialog"] button:has-text("Đăng")'
        ],4500);
        if (posted) {
          await sleep(3500);
          await checkpoint(page);
          result.post.status='DONE';
        } else {
          result.post.status='NEEDS_REVIEW';
          result.post.controls=await visibleControls(page,40);
        }
      } else {
        result.post.status='NEEDS_REVIEW';
        result.post.controls=await visibleControls(page,40);
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