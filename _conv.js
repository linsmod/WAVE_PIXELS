// 收敛观察：默认参数下每 4s 采样相邻相位差，末了截相位图
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=default'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__dbg, null, { timeout: 30000 });

  const sample = () => page.evaluate(async () => {
    const { device, cellBuf, W, H, CELL_WORDS } = window.__dbg;
    const bytes = W * H * CELL_WORDS * 4;
    const rb = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(cellBuf, 0, rb, 0, bytes);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint32Array(rb.getMappedRange().slice(0));
    const f = new Float32Array(u.buffer);
    const ph = (i) => f[i * CELL_WORDS + 16];
    let dx = 0, dy = 0, nx = 0, ny = 0, done = 0, req = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = x + y * W;
      if (u[i * CELL_WORDS + 2] === 3) done++;
      if (u[i * CELL_WORDS + 2] === 2) req++;
      if (x + 1 < W) { const a = ph(i), b = ph(i + 1); dx += Math.abs(((a - b) % 6.2831853 + 9.424778) % 6.2831853 - 3.1415927); nx++; }
      if (y + 1 < H) { const a = ph(i), b = ph(i + W); dy += Math.abs(((a - b) % 6.2831853 + 9.424778) % 6.2831853 - 3.1415927); ny++; }
    }
    return { frame: window.__dbg.frameNo(), dx: +(dx / nx).toFixed(3), dy: +(dy / ny).toFixed(3), done, req };
  });

  for (let k = 1; k <= 8; k++) {
    await page.waitForTimeout(5000);
    console.log(`t=${k * 5}s ` + JSON.stringify(await sample()));
  }
  await page.locator('#cphase').screenshot({ path: 'c:/Users/linswin/GPU_VM/_conv_phase_40s.png' });
  await page.screenshot({ path: 'c:/Users/linswin/GPU_VM/_conv_full_40s.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
