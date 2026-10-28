// 诊断 2：默认参数下相位是否收敛（相邻相位差 / 直方图 / 状态计数）
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

  const read = () => page.evaluate(async () => {
    const { device, cellBuf, W, H, CELL_WORDS } = window.__dbg;
    const bytes = W * H * CELL_WORDS * 4;
    const rb = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(cellBuf, 0, rb, 0, bytes);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(rb.getMappedRange().slice(0));
    const ph = (i) => f[i * CELL_WORDS + 16];
    let dsum = 0, dn = 0;
    const hist = new Array(8).fill(0);
    const st = [0, 0, 0, 0]; let nope = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = x + y * W;
      hist[Math.min(7, Math.floor(ph(i) / (2 * Math.PI) * 8))]++;
      st[f[i * CELL_WORDS + 2]]++;
      if (f[i * CELL_WORDS] === 1) nope++;
      if (x + 1 < W) {
        const a = ph(i), b = ph(i + 1);
        dsum += Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); dn++;
      }
    }
    return { frame: window.__dbg.frameNo(), meanNeighborPhaseDiff: dsum / dn, hist, st, nope };
  });

  for (const wait of [300, 1500, 4000, 8000]) {
    await page.waitForTimeout(wait === 300 ? 300 : wait - 0);
    console.log(`t+${wait} ` + JSON.stringify(await read()));
  }
  // 换 dirMode=2 的最优邻格，再跑 3 秒看是否收敛
  await page.selectOption('#dmode', '2');
  await page.waitForTimeout(3000);
  console.log('mode2 ' + JSON.stringify(await read()));
  console.log('ERRORS: ' + (logs.filter(l => !l.includes('404')).join(' | ') || '(none)'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
