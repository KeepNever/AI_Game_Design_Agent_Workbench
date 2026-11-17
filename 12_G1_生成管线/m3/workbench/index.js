/* G1 工作台 · index 页面逻辑（v2 视觉版，外置——宿主 CSP script-src 'self'）
   数据源全部来自本机 API（/api/*）；管线节点状态来自真实事件流（非演示动画）。 */
'use strict';

var selectedBrief = null;

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
    return '<li class="node ' + m.cls + ' n' + (i + 1) + '">' +
      '<span class="dot">·</span>' +
      '<div class="nhead"><span class="ico">' + m.ico + '</span>' + m.name + '</div>' +
      '<p class="detail">' + m.desc + '</p>' +
      '<div class="state">待执行</div></li>';
  }).join('');
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
    body: JSON.stringify({ brief: brief })
  }).then(function (r) { return r.json(); }).then(function (d) {
    animateStages(d);
    renderEvents(d);
    renderResult(d);
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
      '<div class="result-actions"><a id="enter-preview" class="primary" style="display:block" href="' + esc(d.productUrl) + '">进入预览游玩 →</a></div>';
  } else {
    status.textContent = '生成失败';
    status.className = 'status mock';
    box.innerHTML =
      '<p class="fail">✗ 生成失败：' + esc(d.reason) + '</p>' +
      '<p class="note">失败原因已入档案（' + esc(d.archivesDir || 'archives/workbench-mock/') + '）——Mock 与真实通道的失败结论互不混淆。</p>' +
      '<p class="note">管线画布上标红 ✗ 的节点即拦截位置。</p>';
  }
}

buildStageNodes();
document.getElementById('btn-generate').addEventListener('click', generate);
loadBriefs();
loadGames();
loadBudget();
