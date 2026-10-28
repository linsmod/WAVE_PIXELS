// 临时验证：双图渲染 + 单帧步进语义
const { chromium } = require('playwright');

const readCells = async (page) => page.evaluate(async () => {
  const { device, cellBuf, W, H, CELL_WORDS } = window.__dbg;
  const bytes = W * H * CELL_WORDS * 4;
  const rb = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(cellBuf, 0, rb, 0, bytes);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const out = rb.getMappedRange().slice(0);
  rb.unmap(); rb.destroy();
  return Array.from(new Uint32Array(out));
});
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=default'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const canv = await page.evaluate(() => {
    const a = document.getElementById('c'), b = document.getElementById('cq');
    const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
    return { w: a.width, h: a.height, w2: b.width, h2: b.height,
             sideBySide: Math.abs(r.top - s.top) < 2 && s.left > r.left,
             sizeOK: r.width > 100 && s.width > 100 };
  });
  console.log('CANVAS ' + JSON.stringify(canv));

  await page.click('#pause');
  await page.waitForTimeout(200);
  const f0 = await page.evaluate(() => window.__dbg.frameNo());
  const A = await readCells(page);
  await page.waitForTimeout(500);
  const B = await readCells(page);
  const f1 = await page.evaluate(() => window.__dbg.frameNo());
  console.log(`[暂停] frame ${f0}->${f1}（应相等） buffer 未变=${same(A, B)}`);

  await page.click('#step');
  await page.waitForTimeout(250);
  const f2 = await page.evaluate(() => window.__dbg.frameNo());
  const C = await readCells(page);
  await page.click('#step');
  await page.waitForTimeout(250);
  const f3 = await page.evaluate(() => window.__dbg.frameNo());
  const D = await readCells(page);
  console.log(`[单帧] ${f1}->${f2}->${f3}（应各 +1） 步进后状态改变=${!same(B, C)} ${!same(C, D)}`);

  await page.screenshot({ path: 'c:/Users/linswin/GPU_VM/_s_two.png' });
  console.log('ERRORS: ' + (logs.filter(l => !l.includes('404')).join(' | ') || '(none)'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
