/* G1 工作台 · index 页面逻辑（v2 视觉版，外置——宿主 CSP script-src 'self'）
   数据源全部来自本机 API（/api/*）；管线节点状态来自真实事件流（非演示动画）。 */
'use strict';

var selectedBrief = null;
var lastInspect = null;      // 最近一次生成的 Inspector 真数据
var lastResult = null;       // 最近一次生成结果（试玩嵌回/导出用）
var savedResultHTML = null;  // 试玩前结果面板快照

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function now() {
  var d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return ('0' + n).slice(-2); }).join(':');
}

function thumbFor(title) {
  var t = String(title || '');
  if (t.includes('推箱') || t.includes('推箱到目标点')) return '📦';
  if (t.includes('钥匙')) return '🔑';
  if (t.includes('碎裂')) return '🧊';
  if (t.includes('闸门')) return '⚙';
  if (t.includes('踩灯')) return '💡';
  if (t.includes('翻牌') || t.includes('记忆')) return '🃏';
  return '🎮';
}

/* ── 示例 Brief 下拉 ── */
function loadBriefs() {
  return fetch('/api/briefs').then(function (r) { return r.json(); }).then(function (d) {
    var sel = document.getElementById('brief-select');
    d.briefs.forEach(function (b) {
      var o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.title + (b.injectFirstFailure ? '（内建重试演示）' : '');
      o.dataset.text = b.text;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      selectedBrief = sel.value ? d.briefs.find(function (b) { return b.id === sel.value; }) : null;
      document.getElementById('brief-text').value = selectedBrief ? selectedBrief.text : '';
      document.getElementById('brief-source').textContent = selectedBrief ? selectedBrief.source : '';
    });
  });
}

/* ── 游戏库 ── */
function loadGames() {
  return fetch('/api/games').then(function (r) { return r.json(); }).then(function (d) {
    document.getElementById('game-list').innerHTML = d.games.map(function (g) {
      return '<div class="game-item"><div class="thumb">' + thumbFor(g.title) + '</div>' +
        '<div style="min-width:0"><b>' + esc(g.title) + '</b><small>' + esc(g.sourceLabel) + ' · ' + esc(g.id) + '</small></div>' +
        '<a href="' + esc(g.url) + '">进入预览 →</a></div>';
    }).join('');
  });
}

/* ── 预算：顶栏余量 + 双台账面板 ── */
function loadBudget() {
  return fetch('/api/budget').then(function (r) { return r.json(); }).then(function (d) {
    var remain = Math.max(0, 22 - (d.real.totalSpentCNY || 0));
    document.getElementById('tb-budget').textContent = '¥' + remain.toFixed(2);
    function panel(name, lg, cls) {
      var rows = (lg.entries || []).map(function (e) {
        return '<li>[' + esc(e.type) + '] ' + esc((e.reservationId || '').slice(-8)) +
          (e.costCNY !== undefined ? ' · 核销 ' + esc(e.costCNY) + ' 元' : e.estimate !== undefined ? ' · 预估 ' + esc(e.estimate) + ' 元' : '') + '</li>';
      }).join('');
      return '<div class="budget-panel ' + cls + '" title="' + esc(lg.ledger || '') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<b style="font-size:11px">' + esc(name) + '</b>' +
        (lg.exists === false ? '<span class="muted" style="font-size:10px">尚未建立</span>' : '') + '</div>' +
        '<div style="margin-top:4px">已核销 <b class="tp">' + esc(lg.totalSpentCNY) + '</b> 元 / 22 元 · 占用中 ' + esc(lg.reservedCNY) + ' 元' +
        (lg.holds !== undefined ? ' · hold ' + esc(lg.holds) + ' 笔' : '') + '</div>' +
        (rows ? '<ul class="ledger">' + rows + '</ul>' : '') + '</div>';
    }
    document.getElementById('budget-panels').innerHTML =
      panel('真实台账（22 元总预算）', d.real, 'real') +
      panel('模拟台账（Mock 专用）', d.sim, 'sim');
  });
}

/* ── 管线节点：固定六槽位，状态来自真实事件流 ── */
var SLOT_META = [
  { cls: 'blue', ico: '☷', name: '预算预留', desc: '模拟台账预留 · 超支拒绝' },
  { cls: 'purple', ico: '✧', name: '模型调用', desc: 'Mock 注入候选 · usage 模拟' },
  { cls: 'cyan', ico: '⬡', name: 'Schema 校验', desc: '结构/白名单/交叉引用' },
  { cls: 'amber', ico: '◇', name: 'GT-1 质量闸门', desc: '自动建模 · BFS 三值判定' },
  { cls: 'purple', ico: '⬡', name: '产品包组装', desc: '纯数据核验 + 来源元数据' },
  { cls: 'blue', ico: '◉', name: '归档落盘', desc: 'product.json + 预览注册' }
];

function buildStageNodes() {
  var ul = document.getElementById('stages');
  ul.innerHTML = SLOT_META.map(function (m, i) {
    return '<li class="node ' + m.cls + ' n' + (i + 1) + '" data-idx="' + i + '" title="点击查看真实数据">' +
      '<span class="dot">·</span>' +
      '<div class="nhead"><span class="ico">' + m.ico + '</span>' + m.name + '</div>' +
      '<p class="detail">' + m.desc + '</p>' +
      '<div class="state">待执行</div></li>';
  }).join('');
  ul.querySelectorAll('li').forEach(function (li) {
    li.addEventListener('click', function () {
      ul.querySelectorAll('li').forEach(function (x) { x.style.outline = ''; });
      li.style.outline = '2px solid #9ab0ff';
      renderInspector(Number(li.dataset.idx));
    });
  });
}

/* ── 右侧 Inspector：全部真数据 ── */
function renderInspector(i) {
  var m = SLOT_META[i];
  var el = document.getElementById('inspector');
  var head = '<div class="node-title" style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
    '<span class="ico" style="width:38px;height:38px;border-radius:11px;background:' +
    (m.cls === 'blue' ? '#1d3a6e' : m.cls === 'purple' ? '#3c286e' : m.cls === 'cyan' ? '#123f44' : '#463311') +
    ';display:grid;place-items:center;font-size:19px">' + m.ico + '</span>' +
    '<div><b style="display:block">' + m.name + '</b><small class="' + (lastInspect ? 'ok' : 'muted') + '">' +
    (lastInspect ? '● 来自最近一次生成（真实数据）' : '● 尚未生成') + '</small></div></div>';
  var body = '';
  if (!lastInspect) { el.innerHTML = head + '<p class="note">运行一次生成后，这里展示该节点的真实数据。</p>'; return; }
  if (i === 0) {
    body = '<p class="note">模拟台账（capCNY ' + esc(lastInspect.budget.cap) + '）</p>' +
      '<p>已核销 <b>' + esc(lastInspect.budget.spent) + '</b> 元 · 占用中 ' + esc(lastInspect.budget.reserved) + ' 元</p>' +
      '<ul class="ledger" style="max-height:none">' + (lastInspect.budget.entries || []).map(function (e) {
        return '<li>[' + esc(e.type) + '] …' + esc((e.reservationId || '').slice(-8)) +
          (e.costCNY !== undefined ? ' · ' + esc(e.costCNY) + ' 元' : '') + (e.estimate !== undefined ? ' · 预估 ' + esc(e.estimate) : '') + '</li>';
      }).join('') + '</ul>';
  } else if (i === 1) {
    body = '<p class="note">模型：' + esc(lastResult.model) + ' · 共 ' + esc(lastResult.attempts) + ' 次调用（每次尝试都留档）</p>' +
      (lastInspect.calls || []).map(function (c) {
        return '<div class="budget-panel" style="margin:6px 0"><b class="ok">' + esc(c.outcome) + '</b>' +
          '<div>usage: ' + (c.usage ? esc(c.usage.prompt_tokens) + ' in / ' + esc(c.usage.completion_tokens) + ' out' : '—') + '</div>' +
          '<div class="note">Token 来源: ' + esc(c.input_tokens_source || '—') + ' · 估算 ' + esc(c.estimate_tokens) + ' · ' + esc(c.latency_ms) + 'ms</div></div>';
      }).join('');
  } else if (i === 2) {
    var schemaEv = (lastResult.events || []).filter(function (e) { return e.kind === 'schema'; });
    body = schemaEv.length
      ? '<p class="note">拦截记录（错误清单已结构化回喂模型重试，原始档案在 ' + esc(lastResult.archivesDir) + '）：</p>' +
        '<ul class="ledger" style="max-height:none">' + schemaEv.map(function (e) {
          return '<li>第' + esc(e.attempt) + '回合 · ' + esc(e.errorCount) + ' 项错误 · ' + esc(e.outcome) + '</li>';
        }).join('') + '</ul>'
      : '<p class="status" style="display:inline-block">✓ 本轮全部通过，零拦截</p><p class="note">校验器按 Schema v1.2.1 全量闸门：结构必填 / 白名单 / 交叉引用 / LIMITS / 原型污染键。</p>';
  } else if (i === 3) {
    var sol = lastInspect.solvability || [];
    body = '<p class="note">GT-1 三值判定：PASS / UNSAT（完整穷举）/ UNKNOWN（禁止改写为 UNSAT）</p>' +
      (sol.length && sol[0].verdict ? '<ul class="ledger" style="max-height:none">' + sol.map(function (s) {
        return '<li>关' + esc(s.index) + ' <b class="' + (s.verdict === 'PASS' ? 'ok' : 'bad') + '">' + esc(s.verdict) + '</b>' +
          (s.steps ? ' · 最少 ' + esc(s.steps) + ' 步' : '') + '</li>';
      }).join('') + '</ul>'
      : '<ul class="ledger" style="max-height:none">' + sol.map(function (e) {
          return '<li>第' + esc(e.attempt) + '回合 · ' + esc(e.detail || e.label) + '</li>';
        }).join('') + '</ul>');
  } else if (i === 4) {
    var p = lastInspect.product;
    body = p
      ? '<div class="budget-panel"><b>' + esc(p.format) + '</b>' +
        '<div>字节数: ' + esc(p.integrity.byteLength) + ' · JSON 往返: ' + (p.integrity.roundTripOk ? '<span class="ok">一致 ✓</span>' : '失败') + '</div>' +
        '<div class="note">打包于 ' + esc(p.meta.packaged_at) + '</div>' +
        '<div class="note">Brief: ' + esc(p.meta.brief_id) + ' · 模型: ' + esc(p.meta.model) + ' · Prompt: ' + esc(p.meta.prompt_version) + '</div></div>'
      : '<p class="note">未到达（上游闸门拦截）。</p>';
  } else {
    body = '<p>档案目录：<br><span class="note">' + esc(lastResult.archivesDir) + '</span></p>' +
      (lastResult.productUrl ? '<p>预览地址：<br><span class="note">' + esc(lastResult.productUrl) + '</span></p>' : '<p class="note">未落盘（闸门未全过）。</p>') +
      (lastInspect.product ? '<p class="note">档案引用 ' + (lastInspect.product.meta.archive_refs || []).length + ' 份 · 每次尝试/失败/重试全留痕。</p>' : '');
  }
  el.innerHTML = head + body;
}

function resetStages() {
  document.querySelectorAll('#stages li').forEach(function (li) {
    li.classList.remove('ok', 'fail', 'running');
    li.querySelector('.dot').textContent = '·';
    li.querySelector('.state').textContent = '待执行';
    li.querySelector('.detail').textContent = SLOT_META[Number(li.className.match(/n(\d)/)[1]) - 1].desc;
  });
}

/* 生成完成后：逐节点按真实结果点亮（视觉重放已记录的事件，非假演示） */
function animateStages(d) {
  var lis = document.querySelectorAll('#stages li');
  var i = 0;
  (function tick() {
    if (i >= d.stages.length || i >= lis.length) return;
    var s = d.stages[i], li = lis[i];
    li.classList.add('running');
    li.querySelector('.dot').textContent = '↻';
    li.querySelector('.state').textContent = '执行中…';
    setTimeout(function () {
      li.classList.remove('running');
      li.classList.add(s.ok ? 'ok' : 'fail');
      li.querySelector('.dot').textContent = s.ok ? '✓' : '✗';
      li.querySelector('.state').textContent = s.ok ? '✓ 通过' : '✗ 拦截';
      li.querySelector('.detail').textContent = s.detail || SLOT_META[i].desc;
      i++;
      setTimeout(tick, 140);
    }, 230);
  })();
}

/* ── 生成 ── */
function generate() {
  var btn = document.getElementById('btn-generate');
  var brief = document.getElementById('brief-text').value.trim();
  if (!brief) { alert('请先选择示例 Brief 或输入 Brief 文本'); return; }
  btn.disabled = true;
  btn.textContent = '⏳ 闸门链运行中……';
  resetStages();
  document.getElementById('event-log').innerHTML = '<p class="note">预算预留 → Mock 调用 → 安全解析 → Schema → GT-1 → 组装落盘……</p>';
  document.getElementById('result-status').textContent = '生成中';
  document.getElementById('gen-result').innerHTML = '<div class="result"><div class="result-art">⏳</div><div><b>闸门链运行中</b><p>候选 → 五道闸门 → 产品包 → 预览注册。</p></div></div>';

  fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brief: brief,
      model: document.getElementById('opt-model').value,
      maxAttempts: Number(document.getElementById('opt-attempts').value)
    })
  }).then(function (r) { return r.json(); }).then(function (d) {
    lastInspect = d.inspect || null;
    lastResult = d;
    savedResultHTML = null;
    animateStages(d);
    renderEvents(d);
    renderResult(d);
    renderInspector(0);
    btn.disabled = false;
    btn.textContent = '▶ 运行生成（完整闸门链）';
    loadGames();
    loadBudget();
  }).catch(function (e) {
    document.getElementById('result-status').textContent = '请求失败';
    document.getElementById('gen-result').innerHTML = '<p class="fail">✗ 请求失败：' + esc(e.message) + '</p>';
    btn.disabled = false;
    btn.textContent = '▶ 运行生成（完整闸门链）';
  });
}

function renderEvents(d) {
  var evs = d.events || [];
  document.getElementById('event-log').innerHTML = evs.length
    ? '<ul class="events">' + evs.map(function (e) {
        var bad = e.outcome && e.outcome !== 'parsed' && e.outcome !== 'solve_pass';
        return '<li><span class="att">第' + esc(e.attempt) + '回合</span>' +
          '<span class="k">[' + esc(e.kind) + ']</span>' +
          '<span class="' + (bad ? 'bad' : 'ok') + '">' + esc(e.label) + '</span>' +
          (e.outcome ? '<span class="muted">(' + esc(e.outcome) + ')</span>' : '') + '</li>';
      }).join('') + '</ul>'
    : '<p class="note">无事件</p>';
}

function renderResult(d) {
  var box = document.getElementById('gen-result');
  var status = document.getElementById('result-status');
  if (d.ok) {
    status.textContent = '生成成功（Mock）';
    status.className = 'status';
    box.innerHTML =
      '<p class="success">✓ ' + esc(d.attempts) + ' 回合通过全部闸门 · 模拟台账核销 ' + esc(d.spentCNY) + ' 元（非真实费用）</p>' +
      '<div class="result"><div class="result-art">' + thumbFor(d.productTitle) + '</div><div>' +
      '<b>' + esc(d.productTitle) + '</b>' +
      (d.fallback ? '<p><span class="badge-mock">mockFallback：自由 Brief 未匹配示例</span></p>'
                  : '<p><span class="badge-ok">匹配示例：' + esc(d.matchedBrief ? d.matchedBrief.title : '') + '</span></p>') +
      '<p>档案：' + esc(d.archivesDir) + '</p></div></div>' +
      '<div class="result-actions">' +
      '<button id="btn-embed">⛶ 画布内试玩</button>' +
      '<button id="btn-export">⬇ 导出产物</button>' +
      '<a id="enter-preview" class="primary" style="display:block;flex:1.2;text-align:center;line-height:34px" href="' + esc(d.productUrl) + '">进入预览页 →</a>' +
      '</div>';
    document.getElementById('btn-embed').addEventListener('click', function () { embedPlay(d.productUrl); });
    document.getElementById('btn-export').addEventListener('click', function () { exportProduct(d.productId); });
  } else {
    status.textContent = '生成失败';
    status.className = 'status mock';
    box.innerHTML =
      '<p class="fail">✗ 生成失败：' + esc(d.reason) + '</p>' +
      '<p class="note">失败原因已入档案（' + esc(d.archivesDir || 'archives/workbench-mock/') + '）——Mock 与真实通道的失败结论互不混淆。</p>' +
      '<p class="note">管线画布上标红 ✗ 的节点即拦截位置。</p>';
  }
}

/* ── 画布内试玩：把预览页嵌进结果面板（CSP frame-src 'self' ✓）── */
function embedPlay(url) {
  savedResultHTML = document.getElementById('gen-result').innerHTML;
  document.getElementById('result-status').textContent = '试玩中';
  document.getElementById('gen-result').innerHTML =
    '<iframe src="' + esc(url) + '" style="width:100%;height:420px;border:1px solid #273654;border-radius:10px;background:#080f20"></iframe>' +
    '<div class="result-actions">' +
    '<button id="btn-exit-play">⨯ 收起试玩</button>' +
    '<a class="primary" style="display:block;flex:1;text-align:center;line-height:34px" href="' + esc(url) + '" target="_blank">新窗口打开（大屏）→</a>' +
    '</div>';
  document.getElementById('btn-exit-play').addEventListener('click', function () {
    document.getElementById('gen-result').innerHTML = savedResultHTML;
    document.getElementById('result-status').textContent = '生成成功（Mock）';
    document.getElementById('btn-embed').addEventListener('click', function () { embedPlay(lastResult.productUrl); });
    document.getElementById('btn-export').addEventListener('click', function () { exportProduct(lastResult.productId); });
  });
}

/* ── 导出产物：product + meta 打包下载（曦批次一）── */
function exportProduct(productId) {
  fetch('/api/product/' + encodeURIComponent(productId)).then(function (r) { return r.json(); }).then(function (d) {
    var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = productId + '-bundle.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

buildStageNodes();
document.getElementById('btn-generate').addEventListener('click', generate);
loadBriefs();
loadGames();
loadBudget();
