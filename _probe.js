// 逐格比对：GPU 里存的 delta 与 JS 按公式重算的 delta 是否一致（暂停后 t 不变，可精确比对）
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=default'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__dbg, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.click('#pause');
  await page.waitForTimeout(300);

  const out = await page.evaluate(async () => {
    const { device, cellBuf, W, H, CELL_WORDS, field } = window.__dbg;
    const fp = field();
    const bytes = W * H * CELL_WORDS * 4;
    const rb = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(cellBuf, 0, rb, 0, bytes);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const ab = rb.getMappedRange().slice(0);
    const u = new Uint32Array(ab), f = new Float32Array(ab);

    const kx = 2 * Math.PI / fp.perX, ky = 2 * Math.PI / fp.perY;
    const F = (x, y) => kx * x + ky * y + fp.t;
    const aff = (ph, x, y) => Math.cos(F(x, y) + ph);
    const gain = (phi, phj, xi, yi, xj, yj) =>
      (aff(phj, xi, yi) + aff(phi, xj, yj)) - (aff(phi, xi, yi) + aff(phj, xj, yj));

    let gpuPos = 0, jsPos = 0, signMatch = 0, n = 0, maxErr = 0, sumGpu = 0, sumJs = 0;
    const bad = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = x + y * W, o = i * CELL_WORDS;
      const dGpu = f[o + 5];
      const d = u[o + 1];                       // dir
      const dx = [1, 0, -1, 0][d], dy = [0, 1, 0, -1][d];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = nx + ny * W;
      const dJs = gain(f[o + 16], f[j * CELL_WORDS + 16], x, y, nx, ny);
      n++;
      if (dGpu > 0) gpuPos++;
      if (dJs > 0) jsPos++;
      if ((dGpu > 0) === (dJs > 0)) signMatch++;
      sumGpu += dGpu; sumJs += dJs;
      const err = Math.abs(dGpu - dJs);
      if (err > maxErr) maxErr = err;
      if (err > 1e-4 && bad.length < 5) bad.push({ x, y, d, dGpu, dJs });
    }
    return {
      mode: fp.mode, eps: fp.eps, t: fp.t, perX: fp.perX, perY: fp.perY,
      n, gpuPosFrac: +(gpuPos / n).toFixed(3), jsPosFrac: +(jsPos / n).toFixed(3),
      signMatchFrac: +(signMatch / n).toFixed(3), maxErr, meanGpu: +(sumGpu / n).toFixed(4), meanJs: +(sumJs / n).toFixed(4),
      bad,
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
