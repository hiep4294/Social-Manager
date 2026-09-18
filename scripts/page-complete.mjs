import 'dotenv/config';
import { chromium } from 'playwright-core';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const target = String(process.argv[2] || '').trim();
if (!target) throw new Error('Usage: node scripts/page-complete.mjs <facebook-page-url>');

function clean(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
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

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const profile = path.join(root,'data','facebook-browser-profile');
const browser = process.env.FB_OPERATOR_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ctx = await chromium.launchPersistentContext(profile,{
  executablePath:browser,headless:false,viewport:{width:1440,height:980},locale:'vi-VN'
});

const result = {target, inspect:null, edit:{status:'SKIPPED',changed:[]}, post:{status:'SKIPPED'}};

try {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(4500);
  await checkpoint(page);
  console.log('PAGE_CHECKPOINT_OK url='+page.url());

  const resolved = page.url();
  const title = await page.title().catch(()=> '');
  const h1 = (await page.locator('h1').allTextContents().catch(()=>[])).map(clean).filter(Boolean);
  const name = h1[0] || clean(title.replace(/\s*[|·-]\s*Facebook\s*$/i,'')) || 'Bếp ngon mỗi ngày';
  const body0 = clean(await page.locator('body').innerText().catch(()=>'' )).slice(0,3500);
  result.inspect = {url:resolved,title,page_name:name,text:body0};

  const bio = `${name} – công thức dễ làm, món ngon mỗi ngày và mẹo bếp thực tế. Theo dõi trang để mỗi ngày có thêm một gợi ý cho bữa ăn.`;

  const opened = await clickFirst(page,[
    p=>p.getByRole('button',{name:/edit page details|edit details|chỉnh sửa chi tiết trang|chỉnh sửa thông tin/i}),
    p=>p.getByText(/edit page details|edit details|chỉnh sửa chi tiết trang|chỉnh sửa thông tin/i),
    'a[href*="about"]'
  ],4000);

  if (opened) {
    await sleep(1200);
    if (await fillFirst(page,[
      p=>p.getByLabel(/bio|tiểu sử|mô tả/i),
      'textarea[placeholder*="bio" i]',
      'textarea[placeholder*="mô tả" i]',
      'textarea'
    ],bio,3000)) result.edit.changed.push('bio');

    if (await fillFirst(page,[
      p=>p.getByLabel(/category|danh mục|hạng mục/i),
      'input[placeholder*="category" i]',
      'input[placeholder*="danh mục" i]'
    ],'Food & beverage',2200)) {
      await sleep(700);
      await clickFirst(page,[p=>p.getByRole('option').first(),'[role="option"]'],1500);
      result.edit.changed.push('category');
    }

    if (result.edit.changed.length) {
      const saved = await clickFirst(page,[
        p=>p.getByRole('button',{name:/^(save|lưu|done|xong)$/i}),
        'button:has-text("Save")','button:has-text("Lưu")'
      ],3500);
      result.edit.status = saved ? 'DONE' : 'NEEDS_REVIEW';
      await sleep(1800);
      await checkpoint(page);
    } else result.edit.status='NEEDS_REVIEW';
  } else result.edit.status='NEEDS_REVIEW';

  await page.goto(resolved,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(3500);
  await checkpoint(page);

  const intro = `Chào mừng bạn đến với ${name}!\n\nTrang chia sẻ công thức dễ làm, gợi ý món ăn mỗi ngày và những mẹo bếp thực tế. Theo dõi trang để không bỏ lỡ các món mới.\n\n#MonNgonMoiNgay #CongThucNauAn #BepNha`;
  const currentText = clean(await page.locator('body').innerText().catch(()=>'' ));

  if (currentText.includes('Trang chia sẻ công thức dễ làm')) {
    result.post.status='ALREADY_EXISTS';
  } else {
    const openedPost = await clickFirst(page,[
      p=>p.getByText(/create a post|tạo bài viết|what.?s on your mind|bạn đang nghĩ gì/i),
      '[role="button"]:has-text("Tạo bài viết")'
    ],4500);

    if (!openedPost) result.post.status='NEEDS_REVIEW';
    else {
      await sleep(900);
      const dialog = page.locator('[role="dialog"]').last();
      const editor = dialog.locator('[contenteditable="true"],textarea').first();
      if (await editor.isVisible({timeout:3000}).catch(()=>false)) {
        await editor.fill(intro);
        const posted = await clickFirst(page,[
          p=>p.getByRole('button',{name:/^(post|đăng)$/i}),
          '[role="dialog"] button:has-text("Đăng")'
        ],4000);
        if (posted) {
          await sleep(3500);
          await checkpoint(page);
          result.post.status='DONE';
        } else result.post.status='NEEDS_REVIEW';
      } else result.post.status='NEEDS_REVIEW';
    }
  }

  console.log('PAGE_COMPLETE_RESULT='+JSON.stringify(result));
} finally {
  await ctx.close();
}