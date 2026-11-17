'use strict';
/* G1 工作台 · 浏览器端冒烟（真实 Edge，曦 A 方案验收项）
   前置：preview-server.js 运行中（127.0.0.1:8792）。
   链路：打开工作台 → 选示例 Brief → 点生成 → 闸门进度/事件展示 →
         进入预览 → 键盘通关（按序踩灯 13 步）→ 截图。
   另测：tune-f 重试演示（2 回合，拦截原因展示）+ 预算双台账展示。
*/
const path = require('path');
const { execSync } = require('child_process');
const npmRoot = execSync('npm root -g').toString().trim();
const pw = require(path.join(npmRoot, '@playwright', 'cli', 'node_modules', 'playwright-core'));

const results = [];
async function t(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
  catch (e) { results.push({ name, ok: false, err: String(e.message).slice(0, 200) }); }
}
const BASE = 'http://127.0.0.1:8792';

(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await t('B1 打开工作台：Mock 徽章 + 7 示例下拉 + 游戏库渲染', async () => {
    await page.goto(BASE + '/workbench');
    const badge = await page.textContent('#channel-badge');
    if (!badge.includes('Mock')) throw new Error('缺 Mock 徽章: ' + badge);
    const opts = await page.$$eval('#brief-select option', os => os.filter(o => o.value).length);
    if (opts !== 7) throw new Error('示例 Brief 应 7 个: ' + opts);
    const games = await page.$$eval('#game-list .game-item', gs => gs.length);
    if (games < 5) throw new Error('游戏库过少: ' + games);
    return '徽章✓ 示例 7 ✓ 游戏 ' + games + ' 款';
  });

  await t('B2 选 tune-e 生成：闸门节点全绿 + 事件明细 + 成功面板', async () => {
    await page.selectOption('#brief-select', 'tune-e');
    await page.click('#btn-generate');
    await page.waitForSelector('#gen-result .success', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#stages li.ok').length === 6, { timeout: 30000 });
    const okNodes = await page.$$eval('#stages li.ok', ls => ls.length);
    const failNodes = await page.$$eval('#stages li.fail', ls => ls.length);
    if (okNodes !== 6 || failNodes !== 0) throw new Error('节点 ok=' + okNodes + ' fail=' + failNodes);
    const events = await page.$$eval('#event-log li', ls => ls.length);
    const resultText = await page.textContent('#gen-result');
    if (!resultText.includes('1 回合') || !resultText.includes('非真实费用')) throw new Error('结果面板缺 mock 标注: ' + resultText.slice(0, 120));
    await page.screenshot({ path: path.join(__dirname, 'wb-pipeline-ok.png'), fullPage: false });
    return '6 节点全绿 · 事件 ' + events + ' 条 · 模拟核销标注 ✓';
  });

  await t('B3 进入预览并通关：按序踩灯 13 步（浏览器端可玩完整流程）', async () => {
    await page.click('#enter-preview');
    await page.waitForURL(u => u.pathname.startsWith('/preview/'), { timeout: 10000 });
    let frame = null;
    for (let i = 0; i < 40; i++) {
      frame = page.frames().find(fr => fr.url().includes('/play/'));
      if (frame) {
        try { if (await frame.evaluate(() => window.__PREVIEW_TEST && window.__PREVIEW_TEST.moves === 0)) break; } catch (e) { /* 未就绪 */ }
      }
      await page.waitForTimeout(150);
    }
    if (!frame) throw new Error('游戏帧未就绪');
    const keys = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft',
                  'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowRight'];
    for (const k of keys) {
      await frame.evaluate(kk => window.dispatchEvent(new KeyboardEvent('keydown', { key: kk })), k);
      await page.waitForTimeout(30);
    }
    const info = await frame.evaluate(() => window.__PREVIEW_TEST);
    if (!info.won) throw new Error('未通关: ' + JSON.stringify({ p: info.player, m: info.moves, won: info.won }));
    if (info.moves !== 13) throw new Error('步数异常: ' + info.moves);
    await page.screenshot({ path: path.join(__dirname, 'wb-playthrough.png'), fullPage: true });
    return '通关（13 步，won=true）';
  });

  await t('B4 重试演示（tune-f）：2 回合 + Schema 拦截原因可见 + 失败回合入事件流', async () => {
    await page.goto(BASE + '/workbench');
    await page.selectOption('#brief-select', 'tune-f');
    await page.click('#btn-generate');
    await page.waitForSelector('#gen-result .success', { timeout: 30000 });
    const events = await page.$$eval('#event-log li', ls => ls.map(l => l.textContent));
    const failEv = events.find(e => e.includes('schema') || e.includes('Schema'));
    if (!failEv) throw new Error('缺拦截事件: ' + events.join(' | '));
    const resultText = await page.textContent('#gen-result');
    if (!resultText.includes('2 回合')) throw new Error('重试回合数未展示: ' + resultText.slice(0, 100));
    await page.screenshot({ path: path.join(__dirname, 'wb-retry-demo.png'), fullPage: true });
    return '拦截事件「' + failEv.trim().slice(0, 60) + '…」+ 2 回合成功';
  });

  await t('B7 节点属性 Inspector：点击「模型调用」显示真实档案（usage/Token 来源）', async () => {
    await page.click('#stages li.n2');
    await page.waitForTimeout(100);
    const text = await page.textContent('#inspector');
    if (!text.includes('usage') || !text.includes('Token 来源')) throw new Error('Inspector 缺真实档案数据: ' + text.slice(0, 120));
    return 'Inspector 真数据渲染 ✓';
  });

  await t('B8 画布内试玩：iframe 嵌入预览页，游戏帧可达，可收起', async () => {
    await page.click('#btn-embed');
    let playFrame = null;
    for (let i = 0; i < 30; i++) {
      playFrame = page.frames().find(fr => fr.url().includes('/play/'));
      if (playFrame) break;
      await page.waitForTimeout(150);
    }
    if (!playFrame) throw new Error('内嵌游戏帧未出现');
    await page.click('#btn-exit-play');
    const back = await page.$('#btn-embed');
    if (!back) throw new Error('收起后未还原结果面板');
    return '嵌 iframe → 游戏帧可达 → 收起还原 ✓';
  });

  await t('B9 导出产物：/api/product 端点返回完整产品包', async () => {
    const d = await page.evaluate(async () => {
      const r = await fetch('/api/product/e2e-glm5-demo');
      return { status: r.status, body: await r.json() };
    });
    if (d.status !== 200 || !d.body.ok) throw new Error('导出端点失败: ' + d.status);
    if (!d.body.product.mechanic || !d.body.meta.brief_id) throw new Error('产品包不完整');
    return 'product + meta 完整（' + d.body.id + '）';
  });

  await t('B5 预算双台账展示：模拟台账已核销 > 0；真实台账保持 0（隔离）', async () => {
    await page.reload();
    await page.waitForSelector('.budget-panel.sim');
    const simText = await page.textContent('.budget-panel.sim');
    const realText = await page.textContent('.budget-panel.real');
    const simM = simText.match(/已核销 ([\d.]+)/);
    const simSpent = simM ? parseFloat(simM[1]) : 0;
    if (!(simSpent > 0)) throw new Error('模拟台账应已核销: ' + simText.slice(0, 80));
    const realSpent = parseFloat(realText.match(/已核销 ([\d.]+)/)[1]);
    if (realSpent !== 0) throw new Error('真实台账被污染: ' + realSpent);
    if (!realText.includes('真实台账') || !simText.includes('模拟台账')) throw new Error('缺双台账隔离标注');
    const tb = await page.textContent('#tb-budget');
    if (tb !== '¥22.00') throw new Error('顶栏余量应 ¥22.00（真实台账未动）: ' + tb);
    await page.screenshot({ path: path.join(__dirname, 'wb-workbench.png'), fullPage: true });
    return '模拟 ' + simSpent + ' 元 / 真实 0 元（隔离标注 ✓）';
  });

  await t('B6 全程零页面错误', async () => {
    if (errors.length) throw new Error(errors.join(' | ').slice(0, 200));
    return 'pageerror/console error 均为 0';
  });

  await browser.close();
  const pass = results.filter(r => r.ok).length;
  console.log('=== G1 工作台浏览器冒烟（Edge）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '  → ' + r.detail : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + pass + ' / 失败 ' + (results.length - pass) + ' / 共 ' + results.length + ' ===');
  process.exit(results.length - pass ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
