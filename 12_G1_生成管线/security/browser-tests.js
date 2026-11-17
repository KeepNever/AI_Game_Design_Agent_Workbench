'use strict';
/* M0 · 真实浏览器安全实测（Chromium/Edge，playwright-core 驱动系统 Edge）
   前置：test-server.js 已在 127.0.0.1:8791 运行。
   产出：逐项实测结果（区分于 Node 单元测试），供 M0 验收证据。
*/
const path = require('path');
const { execSync } = require('child_process');

const npmRoot = execSync('npm root -g').toString().trim();
const pw = require(path.join(npmRoot, '@playwright', 'cli', 'node_modules', 'playwright-core'));

const BASE = 'http://127.0.0.1:8791';
const results = [];
async function t(name, fn) {
  try { const detail = await fn(); results.push({ name, ok: true, detail }); }
  catch (e) { results.push({ name, ok: false, err: String(e.message).slice(0, 160) }); }
}

(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  let frame = null;
  await t('BT0 页面加载无控制台错误', async () => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/host/g1');
    await page.waitForTimeout(800);           // 等 fetch + postMessage 数据链路完成
    frame = page.frames().find(f => f.url().includes('/play/'));
    if (!frame) throw new Error('游戏帧未找到');
    if (errors.length) throw new Error('控制台错误: ' + errors.join(' | '));
    return '宿主页+游戏帧加载，控制台 0 错误';
  });

  await t('BT1 iframe sandbox 属性 = allow-scripts（无 allow-same-origin）', async () => {
    const v = await page.evaluate(() => document.querySelector('iframe').getAttribute('sandbox'));
    if (v !== 'allow-scripts') throw new Error('实际值: ' + v);
    return 'sandbox="' + v + '"';
  });

  await t('BT2 生成数据以 application/json 提供（非脚本 MIME）', async () => {
    const mime = await page.evaluate(async () => (await fetch('/data/g1.json')).headers.get('content-type'));
    if (!/^application\/json/.test(mime)) throw new Error('实际 MIME: ' + mime);
    return 'Content-Type: ' + mime;
  });

  await t('BT3 游戏帧经受控 postMessage 收到数据（数据通道走通）', async () => {
    const status = await frame.evaluate(() => document.getElementById('status').textContent);
    const got = await frame.evaluate(() => !!window.__DATA_RECEIVED);
    if (!got) throw new Error('状态: ' + status);
    return status;
  });

  await t('BT4 合法文本惰性展示：敌意标题只显示为文本，未产生可执行标记', async () => {
    const status = await frame.evaluate(() => document.getElementById('status').textContent);
    if (!status.includes('<script>alert(1)</script>')) throw new Error('状态文本不含原文: ' + status);
    const hasExecTag = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('script')).some(s => !s.getAttribute('src') && s.textContent.includes('alert(1)')));
    if (hasExecTag) throw new Error('存在含 alert(1) 的内联脚本');
    return '标题以纯文本呈现（textContent），帧内无对应可执行脚本节点';
  });

  await t('BT5 游戏帧 CSP 实际生效：meta 含 connect-src none', async () => {
    const csp = await frame.evaluate(() => {
      const m = document.querySelector('meta[http-equiv=Content-Security-Policy]');
      return m ? m.content : 'MISSING';
    });
    if (!csp.includes("connect-src 'none'") || !csp.includes("script-src 'self'")) throw new Error('CSP 异常: ' + csp);
    return 'CSP 就位（script-src self / connect-src none）';
  });

  await t('BT6 外网访问被 CSP 拦截（游戏帧 connect-src none）', async () => {
    const r = await frame.evaluate(async () => {
      try { const res = await fetch('http://127.0.0.99:9/exfil'); return 'ALLOWED ' + res.status; }
      catch (e) { return 'BLOCKED: ' + e.message.slice(0, 60); }
    });
    if (!r.startsWith('BLOCKED')) throw new Error(r);
    return r;
  });

  await t('BT7 游戏帧 opaque origin：localStorage 被拒（无 allow-same-origin）', async () => {
    const r = await frame.evaluate(() => {
      try { window.localStorage.setItem('x', '1'); return 'ACCESSIBLE'; }
      catch (e) { return 'BLOCKED: ' + e.name; }
    });
    if (!r.startsWith('BLOCKED')) throw new Error(r);
    return r;
  });

  await t('BT8 宿主隔离：游戏帧读 parent.location.href 被跨源拦截', async () => {
    const r = await frame.evaluate(() => {
      try { return 'READ ' + window.parent.location.href; }
      catch (e) { return 'BLOCKED: ' + e.name; }
    });
    if (!r.startsWith('BLOCKED')) throw new Error(r);
    return r;
  });

  await t('BT9 postMessage 校验：游戏帧发出的非法类型被宿主丢弃', async () => {
    await frame.evaluate(() => window.parent.postMessage({ type: 'evil:exec', code: 'alert(1)' }, '*'));
    await frame.evaluate(() => window.parent.postMessage({ type: 'game:win' }, '*'));  // 合法对照
    await page.waitForTimeout(400);
    const dropped = await page.evaluate(() => window.__DROPPED);
    const events = await page.evaluate(() => window.__EVENTS);
    if (dropped < 1) throw new Error('非法消息未被丢弃计数');
    if (!events.includes('game:win')) throw new Error('合法消息被误杀');
    return 'evil:exec 被丢弃（累计 ' + dropped + '），game:win 正常放行';
  });

  await t('BT11 超大 JSON 响应在解析前被拒（受限拉取：大小限制先于解析）', async () => {
    // /data/big.json：故意不闭合的 300KB JSON（无 Content-Length，走流式路径）
    const r = await page.evaluate(async () => {
      try { const data = await window.__fetchCapped('/data/big.json'); return 'ALLOWED(已解析)'; }
      catch (e) { return (e.code || '') + '|' + e.message.slice(0, 80); }
    });
    if (!r.startsWith('PAYLOAD_TOO_LARGE')) throw new Error('实际: ' + r + '——若为 INVALID_JSON 说明限制发生在解析之后');
    return r;
  });

  await t('BT12 来源校验实证：无关游戏实例帧发送合法格式 game:win 也被宿主丢弃', async () => {
    const beforeWin = await page.evaluate(() => window.__EVENTS.filter(t => t === 'game:win').length);
    const beforeDropped = await page.evaluate(() => window.__DROPPED);
    // 无关窗口 = 另一个真实加载的游戏实例帧 /play/g2（非宿主认可的 g1 帧）
    await page.evaluate(() => new Promise(resolve => {
      const f2 = document.createElement('iframe');
      f2.src = '/play/g2';
      f2.onload = () => setTimeout(resolve, 500);
      document.body.appendChild(f2);
    }));
    const g2 = page.frames().find(f => f.url().includes('/play/g2'));
    if (!g2) throw new Error('g2 帧未加载');
    await g2.evaluate(() => window.parent.postMessage({ type: 'game:win' }, '*'));  // 合法格式、非法来源
    await page.waitForTimeout(400);
    const afterWin = await page.evaluate(() => window.__EVENTS.filter(t => t === 'game:win').length);
    const dropped = await page.evaluate(() => window.__DROPPED);
    if (afterWin !== beforeWin) throw new Error('非法来源的合法格式消息被放行（game:win 事件 ' + beforeWin + '→' + afterWin + '）');
    if (dropped <= beforeDropped) throw new Error('丢弃计数未增加');
    return '无关来源 game:win 被丢（SOURCE_MISMATCH），game:win 事件数 ' + beforeWin + '→' + afterWin + '，丢弃累计 ' + dropped;
  });

  await t('BT10 游戏帧脚本面干净：全部为固定一方 src，无内联无生成数据', async () => {
    const info = await frame.evaluate(() => ({
      srcs: Array.from(document.querySelectorAll('script')).map(s => s.getAttribute('src')),
      inline: Array.from(document.querySelectorAll('script')).filter(s => !s.getAttribute('src')).length
    }));
    if (info.inline > 0) throw new Error('存在内联脚本 ' + info.inline + ' 个');
    if (info.srcs.some(s => !s || !s.startsWith('/engine/'))) throw new Error('存在非 /engine/ 脚本: ' + info.srcs);
    return info.srcs.join(', ');
  });

  await browser.close();

  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('=== M0 安全测试（真实浏览器层 · Edge/Chromium）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '  → ' + r.detail : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' / 共 ' + results.length + ' ===');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
