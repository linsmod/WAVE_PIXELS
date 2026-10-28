// 临时验证：4 图渲染 + 新 payload(color+phase) 的交换正确性 + 单帧步进
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

const N = 256 * 256;
const CMD = 0, STATE = 2, WISH = 3, PARTNER = 7, COLOR = 8, PH = 16;

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
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const ids = ['c', 'cphase', 'creq', 'cpair'];
    return ids.map(id => {
      const cv = document.getElementById(id);
      const r = cv.getBoundingClientRect();
      return { id, w: cv.width, h: cv.height, disp: r.width > 50 && r.height > 50 };
    });
  });
  console.log('CANVASES ' + JSON.stringify(info));

  const cw = await page.evaluate(() => window.__dbg.CELL_WORDS);
  const get = (buf, i, f) => buf[i * cw + f];

  for (const mode of ['0', '1', '2']) {
    await page.selectOption('#dmode', mode);
    await page.locator('#eps').fill('-0.2');
    await page.locator('#eps').dispatchEvent('input');
    await page.waitForTimeout(700);
    const A = await readCells(page);
    await page.waitForTimeout(150);
    const B = await readCells(page);

    let swapped = 0, mutual = 0, req = 0, nope = 0;
    let colA = 0, colB = 0, phA = 0, phB = 0;
    for (let i = 0; i < N; i++) {
      if (get(B, i, CMD) === 1) { nope++; }
      const st = get(B, i, STATE);
      if (st === 2) req++;
      if (st === 3) {
        swapped++;
        const p = get(B, i, PARTNER);
        if (p !== 0xFFFFFFFF && p < N && get(B, p, PARTNER) === i) mutual++;
      }
      for (let k = 0; k < 4; k++) { colA += get(A, i, COLOR + k); colB += get(B, i, COLOR + k); }
      phA += get(A, i, PH); phB += get(B, i, PH);
    }
    console.log(`[dirMode=${mode}] 请求中=${req} 完成交换=${swapped} 互愿一致=${mutual} 无信号=${nope} | ` +
                `color 多重集不变=${colA === colB} phase 多重集不变=${phA === phB}`);
  }

  await page.click('#pause');
  await page.waitForTimeout(200);
  const f0 = await page.evaluate(() => window.__dbg.frameNo());
  await page.click('#step');
  await page.waitForTimeout(250);
  const f1 = await page.evaluate(() => window.__dbg.frameNo());
  console.log(`[单帧] ${f0} -> ${f1}（应 +1）`);

  await page.screenshot({ path: 'c:/Users/linswin/GPU_VM/_s_four.png' });
  console.log('ERRORS: ' + (logs.filter(l => !l.includes('404')).join(' | ') || '(none)'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
