'use strict';
/* G1 M3 · 最小预览页浏览器冒烟（真实 Edge）
   前置：preview-server.js 已运行（127.0.0.1:8792）。
   验证：页面加载 → 数据通道 → 渲染 → 键盘操作 → 状态/事件反馈 → R 重启 → 宿主按钮重启。
   注意：游戏帧是 sandbox opaque origin——主页面 JS 不可直读其 document（M0 安全层）；
   冒烟一律通过 playwright 的 frame 上下文（page.frames()）评估，并轮询等待帧就绪。
*/
const path = require('path');
const { execSync } = require('child_process');
const npmRoot = execSync('npm root -g').toString().trim();
const pw = require(path.join(npmRoot, '@playwright', 'cli', 'node_modules', 'playwright-core'));

const results = [];
async function t(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
  catch (e) { results.push({ name, ok: false, err: String(e.message).slice(0, 160) }); }
}

async function waitFrameReady(page, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  for (;;) {
    const f = page.frames().find(fr => fr.url().includes('/play/'));
    if (f) {
      try {
        const ready = await f.evaluate(() => !!window.__PREVIEW_TEST && window.__PREVIEW_TEST.moves === 0);
        if (ready) return f;
      } catch (e) { /* 帧尚未就绪 */ }
    }
    if (Date.now() > deadline) throw new Error('游戏帧就绪超时');
    await page.waitForTimeout(120);
  }
}

(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await t('S0 页面加载：数据通道走通，游戏帧就绪，控制台 0 错误', async () => {
    await page.goto('http://127.0.0.1:8792/preview/gameA_%E6%8E%A8%E7%AE%B1');
    const f = await waitFrameReady(page);
    if (consoleErrors.length) throw new Error('控制台错误: ' + consoleErrors.join(' | '));
    const hostStatus = await page.evaluate(() => document.getElementById('host-status').textContent);
    return '宿主状态: ' + hostStatus + '；帧就绪';
  });

  const readTest = async () => {
    const f = page.frames().find(fr => fr.url().includes('/play/'));
    return f.evaluate(() => window.__PREVIEW_TEST);
  };

  await t('S1 初始渲染：玩家位于构造样本初始位 (3,1)，步数 0', async () => {
    const info = await readTest();
    if (!info) throw new Error('__PREVIEW_TEST 不可读');
    if (info.player.x !== 3 || info.player.y !== 1) throw new Error('初始位错误: ' + JSON.stringify(info.player));
    if (info.moves !== 0) throw new Error('初始步数非 0');
    return 'player (3,1)，moves 0';
  });

  await t('S2 键盘操作：右移×2 踩到 a 踏板，步数=2', async () => {
    const f = page.frames().find(fr => fr.url().includes('/play/'));
    await f.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    await page.waitForTimeout(100);
    const info = await readTest();
    if (info.player.x !== 5 || info.player.y !== 1) throw new Error('右移后位置错误: ' + JSON.stringify(info.player));
    if (info.moves !== 2) throw new Error('步数错误: ' + info.moves);
    return 'player (3,1) a 踏板，moves 2';
  });

  await t('S3 反馈：状态栏渲染机制状态，事件日志非空', async () => {
    const f = page.frames().find(fr => fr.url().includes('/play/'));
    const status = await f.evaluate(() => document.getElementById('status').textContent);
    if (!status.includes('2')) throw new Error('状态栏无步数反馈: ' + status);
    const evCount = await f.evaluate(() => document.getElementById('events').childElementCount);
    if (evCount < 1) throw new Error('事件日志为空');
    return '状态栏: ' + status.slice(0, 40) + '；事件条目 ' + evCount;
  });

  await t('S4 帧内重启（R 键）：回到初始位 (3,1)，步数 0', async () => {
    const f = page.frames().find(fr => fr.url().includes('/play/'));
    await f.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' })));
    await page.waitForTimeout(100);
    const info = await readTest();
    if (info.player.x !== 3 || info.player.y !== 1 || info.moves !== 0) throw new Error('重启失败: ' + JSON.stringify(info));
    return 'R 键重启生效';
  });

  await t('S5 宿主重启按钮：重建 iframe，游戏帧全新加载', async () => {
    const f = page.frames().find(fr => fr.url().includes('/play/'));
    await f.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    await page.click('#restart-btn');
    const nf = await waitFrameReady(page, 8000);   // 新帧就绪（moves 0）
    const info = await nf.evaluate(() => window.__PREVIEW_TEST);
    if (info.moves !== 0) throw new Error('重建后步数非 0');
    return 'iframe 重建 → 全新游戏帧（moves 0）';
  });

  await t('S6 最终：控制台 0 错误', async () => {
    if (consoleErrors.length) throw new Error('控制台错误: ' + consoleErrors.join(' | '));
    return '全程无控制台错误';
  });

  await page.screenshot({ path: path.join(__dirname, 'preview-smoke.png'), fullPage: true });
  await browser.close();

  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('=== G1 M3 最小预览页浏览器冒烟（Edge）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '  → ' + r.detail : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' / 共 ' + results.length + ' ===');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
