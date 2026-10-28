// 验证 v5：布局紧凑度 / 色相修复（相位图、配对图是否有真实彩色）/ 单帧步进 / 着色器无错
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=default'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__dbg, null, { timeout: 30000 });
  // 相位图/配对图需要时间才能排出条纹；先跑 12s
  await page.waitForTimeout(12000);

  const geo = await page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const ids = ['c', 'cphase', 'creq', 'cpair'];
    const cvs = ids.map(id => ({ id, ...r(document.getElementById(id)) }));
    const hud = r(document.getElementById('hud'));
    const overlap = cvs.some(c => c.x < hud.x + hud.w && hud.x < c.x + c.w && c.y < hud.y + hud.h && hud.y < c.y + c.h);
    const [a, b, d, e] = cvs;  // 左上 右上 左下 右下
    return {
      cvs, hud, overlap,
      gapX: +(b.x - (a.x + a.w)).toFixed(1),
      gapY: +(d.y - (a.y + a.h)).toFixed(1),
      squareErr: Math.max(...cvs.map(c => Math.abs(c.w - c.h))),
      sizeErr: Math.max(...cvs.map(c => Math.abs(c.w - a.w))),
      block: { x: a.x, y: a.y, w: +(e.x + e.w - a.x).toFixed(1), h: +(e.y + e.h - a.y).toFixed(1) },
    };
  });
  console.log('GEO ' + JSON.stringify(geo));

  await page.locator('#cphase').screenshot({ path: 'c:/Users/linswin/GPU_VM/_v5_phase.png' });
  await page.locator('#cpair').screenshot({ path: 'c:/Users/linswin/GPU_VM/_v5_pair.png' });
  await page.screenshot({ path: 'c:/Users/linswin/GPU_VM/_v5_full.png' });

  // 折叠 HUD 后：舞台应吃掉空出的宽度，且仍不重叠
  await page.click('#h1');
  await page.waitForTimeout(600);
  const geo2 = await page.evaluate(() => {
    const b = document.getElementById('c').getBoundingClientRect();
    const h = document.getElementById('hud').getBoundingClientRect();
    return { canvas: { x: +b.x.toFixed(1), w: +b.width.toFixed(1) }, hud: { x: +h.x.toFixed(1), w: +h.width.toFixed(1) } };
  });
  console.log('HUD-MIN ' + JSON.stringify(geo2));
  await page.screenshot({ path: 'c:/Users/linswin/GPU_VM/_v5_min.png' });
  await page.click('#h1');

  // 单帧步进
  await page.click('#pause');
  await page.waitForTimeout(200);
  const f0 = await page.evaluate(() => window.__dbg.frameNo());
  await page.click('#step');
  await page.waitForTimeout(250);
  const f1 = await page.evaluate(() => window.__dbg.frameNo());
  console.log(`[单帧] ${f0} -> ${f1}（应 +1）`);

  console.log('ERR-PANEL ' + await page.evaluate(() => {
    const e = document.getElementById('err');
    return getComputedStyle(e).display === 'none' ? 'hidden' : e.textContent.slice(0, 200);
  }));
  console.log('ERRORS: ' + (logs.filter(l => !l.includes('404')).join(' | ') || '(none)'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
