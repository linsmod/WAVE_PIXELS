// 诊断：相位图观感（默认 eps） + 布局几何
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
  await page.waitForTimeout(4000);

  const geo = await page.evaluate(() => {
    const ids = ['c', 'cphase', 'creq', 'cpair'];
    return ids.map(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  console.log('GEO ' + JSON.stringify(geo, null, 0));
  console.log('HUD ' + JSON.stringify(await page.evaluate(() => {
    const r = document.getElementById('hud').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })));

  // 相位画布截图，统计颜色分布与空间相邻差异（越大越花）
  const shot = await page.locator('#cphase').screenshot({ path: 'c:/Users/linswin/GPU_VM/_diag_phase.png' });
  const stats = await page.evaluate(async (buf) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + buf.toString('base64');
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width;
    let sat = 0, mono = 0, n = 0, adj = 0, adjN = 0;
    const lum = [];
    for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < W; x += 2) {
      const o = (y * W + x) * 4;
      const r = d[o], g = d[o + 1], b = d[o + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat += mx ? 1 - mn / mx : 0;
      if (mx - mn <= 8) mono++;
      n++;
      lum.push([x, y, (r + g + b) / 3]);
      if (x + 2 < W) { const o2 = (y * W + x + 2) * 4; adj += Math.abs(r - d[o2]) + Math.abs(g - d[o2 + 1]) + Math.abs(b - d[o2 + 2]); adjN++; }
    }
    return { w: cv.width, meanSat: sat / n, monoFrac: mono / n, adjDiff: adj / adjN };
  }, shot);
  console.log('PHASE ' + JSON.stringify(stats));

  // 相位是否已收敛：读回 ph，看相邻格相位差
  const conv = await page.evaluate(async () => {
    const { device, cellBuf, W, H, CELL_WORDS } = window.__dbg;
    const bytes = W * H * CELL_WORDS * 4;
    const rb = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(cellBuf, 0, rb, 0, bytes);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(rb.getMappedRange().slice(0));
    const ph = (i) => f[i * CELL_WORDS + 16];
    let dsum = 0, dn = 0, hist = new Array(8).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x + 1 < W; x++) {
      const a = ph(x + y * W), b = ph(x + 1 + y * W);
      // 环形差
      let d = Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      dsum += d; dn++;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hist[Math.min(7, Math.floor(ph(x + y * W) / (2 * Math.PI) * 8))]++;
    return { meanNeighborPhaseDiff: dsum / dn, hist, frame: window.__dbg.frameNo() };
  });
  console.log('CONV ' + JSON.stringify(conv));
  console.log('ERRORS: ' + (logs.filter(l => !l.includes('404')).join(' | ') || '(none)'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
