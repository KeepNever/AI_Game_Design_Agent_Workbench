/* G1 工作台 · index 页面逻辑（外置——宿主 CSP script-src 'self' 禁止内联脚本）
   数据源全部来自本机 API（/api/*，connect-src 'self'）；不触达任何外部地址。 */
'use strict';

var selectedBrief = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ── 示例 Brief 下拉 ──
function loadBriefs() {
  return fetch('/api/briefs').then(function (r) { return r.json(); }).then(function (d) {
    var sel = document.getElementById('brief-select');
    d.briefs.forEach(function (b) {
      var o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.title + (b.injectFirstFailure ? '（内建重试演示）' : '');
      o.dataset.text = b.text;
      o.dataset.source = b.source;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      var o = sel.selectedOptions[0];
      selectedBrief = sel.value ? d.briefs.find(function (b) { return b.id === sel.value; }) : null;
      document.getElementById('brief-text').value = sel.value ? o.dataset.text : '';
      document.getElementById('brief-source').textContent = selectedBrief ? '来源：' + selectedBrief.source : '';
    });
  });
}

// ── 游戏列表 ──
function loadGames() {
  return fetch('/api/games').then(function (r) { return r.json(); }).then(function (d) {
    var box = document.getElementById('game-list');
    box.innerHTML = d.games.map(function (g) {
      return '<div class="game-item"><b>' + esc(g.title) + '</b> <span class="tag src-' + esc(g.source) + '">' +
        esc(g.sourceLabel) + '</span> <a href="' + esc(g.url) + '">进入预览 →</a> <span class="note">' + esc(g.id) + '</span></div>';
    }).join('');
  });
}

// ── 预算面板 ──
function loadBudget() {
  return fetch('/api/budget').then(function (r) { return r.json(); }).then(function (d) {
    function panel(name, lg, cls) {
      var rows = (lg.entries || []).map(function (e) {
        return '<li>[' + esc(e.type) + '] ' + esc(e.reservationId || '') + (e.costCNY !== undefined ? ' 核销 ' + esc(e.costCNY) + ' 元' : e.estimate !== undefined ? ' 预估 ' + esc(e.estimate) + ' 元' : '') + '</li>';
      }).join('');
      return '<div class="budget-panel ' + cls + '"><b>' + esc(name) + '</b>' +
        '<div>已核销 <b>' + esc(lg.totalSpentCNY) + '</b> 元 / 22 元 · 占用中 ' + esc(lg.reservedCNY) + ' 元' +
        (lg.holds !== undefined ? ' · hold ' + esc(lg.holds) + ' 笔' : '') +
        (lg.exists === false ? ' · <i>台账尚未建立</i>' : '') + '</div>' +
        (rows ? '<ul class="ledger">' + rows + '</ul>' : '<p class="note">暂无条目</p>') + '</div>';
    }
    document.getElementById('budget-panels').innerHTML =
      panel('真实台账（22 元总预算——Mock 通道绝不写入）', d.real, 'real') +
      panel('模拟台账（本工作台 Mock 专用）', d.sim, 'sim');
  });
}

// ── 生成 ──
function generate() {
  var btn = document.getElementById('btn-generate');
  var brief = document.getElementById('brief-text').value.trim();
  if (!brief) { alert('请先选择示例 Brief 或输入 Brief 文本'); return; }
  btn.disabled = true;
  btn.textContent = '生成中……';
  document.getElementById('sec-progress').hidden = false;
  document.getElementById('stages').innerHTML = '<p class="note">闸门链运行中：预算预留 → Mock 调用 → 安全解析 → Schema → GT-1 → 组装器 → 落盘……</p>';
  document.getElementById('event-log').innerHTML = '';
  document.getElementById('gen-result').innerHTML = '';

  fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief: brief })
  }).then(function (r) { return r.json(); }).then(function (d) {
    renderResult(d);
    btn.disabled = false;
    btn.textContent = '生成（走完整闸门链）';
    loadGames();
    loadBudget();
  }).catch(function (e) {
    document.getElementById('gen-result').innerHTML = '<p class="fail">请求失败：' + esc(e.message) + '</p>';
    btn.disabled = false;
    btn.textContent = '生成（走完整闸门链）';
  });
}

function renderResult(d) {
  // 闸门节点
  document.getElementById('stages').innerHTML = '<ul class="stages">' + (d.stages || []).map(function (s) {
    return '<li class="' + (s.ok ? 'ok' : 'fail') + '">' + (s.ok ? '✓' : '✗') + ' <b>' + esc(s.node) + '</b>' +
      (s.detail ? ' — <span class="note">' + esc(s.detail) + '</span>' : '') + '</li>';
  }).join('') + '</ul>';

  // 事件明细（逐回合）
  document.getElementById('event-log').innerHTML = (d.events || []).length
    ? '<ul class="events">' + d.events.map(function (e) {
        return '<li>第 ' + esc(e.attempt) + ' 回合 · [' + esc(e.kind) + '] ' + esc(e.label) +
          (e.outcome ? ' <span class="note">(' + esc(e.outcome) + ')</span>' : '') + '</li>';
      }).join('') + '</ul>'
    : '<p class="note">无事件</p>';

  // 结果
  var box = document.getElementById('gen-result');
  if (d.ok) {
    box.innerHTML =
      '<p class="success">✓ 生成成功（' + esc(d.attempts) + ' 回合）· 模拟台账核销 ' + esc(d.spentCNY) + ' 元（非真实费用）</p>' +
      '<p>' + (d.fallback
        ? '<span class="badge-mock">mockFallback：自由 Brief 未匹配示例，按 fallback 候选生成</span>'
        : '<span class="badge-ok">匹配示例 Brief：' + esc(d.matchedBrief ? d.matchedBrief.title : '') + '</span>') + '</p>' +
      '<p>产物《' + esc(d.productTitle) + '》 · 档案 ' + esc(d.archivesDir) + '</p>' +
      '<p><a class="enter" id="enter-preview" href="' + esc(d.productUrl) + '">进入预览游玩 →</a></p>';
  } else {
    box.innerHTML = '<p class="fail">✗ 生成失败：' + esc(d.reason) + '</p>' +
      '<p class="note">失败原因已入档案（' + esc(d.archivesDir || 'archives/workbench-mock/') + '）——Mock 与真实通道的失败结论互不混淆。</p>';
  }
}

document.getElementById('btn-generate').addEventListener('click', generate);
loadBriefs();
loadGames();
loadBudget();
