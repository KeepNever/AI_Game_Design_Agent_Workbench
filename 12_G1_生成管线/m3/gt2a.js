'use strict';
/* G1 M3 · GT-2a 逐步状态观测与断言（曦 M3 第二步）
   两条路径严格区分：
   - 【通关路径重放】（kind='path-replay'）：GT-1 求解路径（或显式路径）逐步重放，
     每步记录 {step, dir, moved, events, state 快照}，终点断言 win——候选路径 → 真实通关证据；
   - 【机制专项测试路径】（kind='mechanism'）：面向机制语义的定向场景
     （推箱跟随/撞墙、拾钥门禁、碎裂衰减、踏板开闸……），逐步断言
     moved / var / cellProp / playerAt / entityAt / win——验证机制语义本身，而非通关。
   断言全部基于逐步观测（每步 tryMove 后的 state 快照 + moved + events），确定性可复核。
*/
const { solveLevel } = require('../validator/solver');

function assertPureData(obj, where, failures) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'function') failures.push({ where: where + '.' + k, code: 'NOT_PURE_DATA' });
    else assertPureData(v, where + '.' + k, failures);
  }
}

/* 单条断言求值：基于当前观测（r = tryMove 结果，state，rules，level） */
function evalAssertion(a, ctx, failures) {
  const { r, state, rules, level } = ctx;
  const desc = 'step' + (a.afterStep || 'end') + '/' + a.type;
  switch (a.type) {
    case 'moved':
      if (!!r.moved !== !!a.value) failures.push({ desc, expect: a.value, actual: !!r.moved });
      break;
    case 'var':
      if (state.vars[a.key] !== a.value) failures.push({ desc, expect: a.value, actual: state.vars[a.key] });
      break;
    case 'cellProp': {
      const cell = state.cellProps[a.x + ',' + a.y] || {};
      if (cell[a.prop] !== a.value) failures.push({ desc: desc + '@' + a.x + ',' + a.y, prop: a.prop, expect: a.value, actual: cell[a.prop] === undefined ? null : cell[a.prop] });
      break;
    }
    case 'playerAt':
      if (state.player.x !== a.x || state.player.y !== a.y) failures.push({ desc, expect: a.x + ',' + a.y, actual: state.player.x + ',' + state.player.y });
      break;
    case 'entityAt': {
      const at = state.entities.some(e => e.type === a.entity && e.x === a.x && e.y === a.y);
      if (!at) failures.push({ desc, expect: a.entity + '@' + a.x + ',' + a.y, actual: '不在' });
      break;
    }
    case 'noEntityAt': {
      const at = state.entities.some(e => e.type === a.entity && e.x === a.x && e.y === a.y);
      if (at) failures.push({ desc, expect: a.entity + ' 已移除', actual: a.entity + ' 仍在 ' + a.x + ',' + a.y });
      break;
    }
    case 'win': {
      let won = false;
      try { won = !!rules.isWin(state, level); } catch (e) { won = false; }
      if (won !== !!a.value) failures.push({ desc, expect: a.value, actual: won });
      break;
    }
    default:
      failures.push({ desc, expect: null, actual: 'UNKNOWN_ASSERTION_TYPE ' + a.type });
  }
}

/* runScenario(DSLRules, mechanic, levels, scenario)
   scenario: { kind: 'path-replay'|'mechanism', name, level, moves?, assertions?: [...] }
   moves 缺省且为 path-replay 时由 GT-1 求解器给路（候选路径）后逐步重放。 */
function runScenario(DSLRules, mechanic, levels, scenario, opts) {
  const failures = [];
  assertPureData(scenario, 'scenario', failures);
  const level = levels[scenario.level];
  if (!level) return { name: scenario.name, kind: scenario.kind, pass: false, failures: [{ desc: 'level', expect: null, actual: 'LEVEL_NOT_FOUND' }] };
  const rules = DSLRules(mechanic, [level]);
  let state = rules.init(level, 0);

  let moves = scenario.moves || null;
  let solvedBy = null;
  if (!moves && scenario.kind === 'path-replay') {
    const sol = solveLevel(DSLRules, mechanic, level, { errProbe: opts && opts.errProbe });
    if (sol.solvable !== true) {
      return { name: scenario.name, kind: scenario.kind, pass: false,
               failures: [{ desc: 'path', expect: 'PASS', actual: sol.reason }] };
    }
    moves = sol.path; solvedBy = 'gt1-solver';
  }
  const steps = (moves || '').split('').filter(c => 'UDLR'.includes(c));

  const observations = [];
  for (let i = 0; i < steps.length; i++) {
    const dir = steps[i];
    let r;
    try { r = rules.tryMove(state, dir, level); }
    catch (e) {
      failures.push({ desc: 'step' + (i + 1) + '/' + dir, expect: null, actual: 'RUNTIME_ERROR ' + e.message.slice(0, 100) });
      break;
    }
    state = r.state;
    observations.push({ step: i + 1, dir, moved: !!r.moved, events: (r.events || []).map(e => e.msg || '') });
    const ctx = { r, state, rules, level };
    for (const a of (scenario.assertions || [])) {
      if (a.afterStep === i + 1) evalAssertion(a, ctx, failures);
    }
  }

  // 终态：win 断言（type='win' 且无 afterStep）
  const ctx = { r: { moved: false, events: [] }, state, rules, level };
  for (const a of (scenario.assertions || [])) {
    if (!a.afterStep) evalAssertion(a, ctx, failures);
  }

  return {
    name: scenario.name, kind: scenario.kind, level: scenario.level,
    pass: failures.length === 0, failures,
    steps: steps.length, won: (() => { try { return !!rules.isWin(state, level); } catch (e) { return false; } })(),
    observations, solvedBy
  };
}

/* runGame(DSLRules, mechanic, levels, gameDef, opts)
   gameDef: { scenarios: [...] } → 分两类汇总：
   { pathReplays: [...], mechanisms: [...], pass, summary } */
function runGame(DSLRules, mechanic, levels, gameDef, opts) {
  const pathReplays = [], mechanisms = [];
  for (const sc of gameDef.scenarios) {
    const r = runScenario(DSLRules, mechanic, levels, sc, opts);
    (sc.kind === 'path-replay' ? pathReplays : mechanisms).push(r);
  }
  const all = pathReplays.concat(mechanisms);
  return {
    pathReplays, mechanisms,
    pass: all.every(r => r.pass),
    summary: {
      pathReplays: pathReplays.length + ' 项（通过 ' + pathReplays.filter(r => r.pass).length + '）',
      mechanisms: mechanisms.length + ' 项（通过 ' + mechanisms.filter(r => r.pass).length + '）'
    }
  };
}

module.exports = { runScenario, runGame };
