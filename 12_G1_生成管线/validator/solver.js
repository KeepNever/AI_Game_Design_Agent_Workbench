'use strict';
/* G1 M2 · GT-1 求解验证（Node · 自动建模路线）
   原理：DSL 运行时本身就是状态转移函数——加载 dsl_runtime.js（vm 沙箱，只装可信一方代码），
   对每个状态枚举 U/D/L/R 四向 tryMove，以状态快照（纯 JSON）为去重键做 BFS。

   【状态快照审计（曦 2026-11-13 指令 1）】
   快照字段 = { vars, cellProps, entities, player }。对 dsl_runtime.js 全量核对：
   - 影响未来转移的字段：vars（规则求值）、cellProps（属性/覆盖层/pit）、entities（碰撞/推动/拾取）、
     player（位置）——全部在快照内；
   - 影响胜利判断的字段：win 表达式经 ctxFor(player) 可读 vars / cellProps / entities（count_entity 系）/
     player——全部在快照内；
   - 不入快照的运行时内部状态 A.*（parts/moveT/shake/bump/pFrom/pT0/lastDir/logs/_logMark）
     全部为表现层（动画/事件日志），不影响转移与胜负；
   - 地图与机制数据按关静态，作为常量参与转移，不随搜索变化。
   ⇒ 快照完备（审计复核于 2026-11-13，依据 dsl_runtime.js 源码逐引用核对）。

   【搜索不变性】tryMove 以 JSON 快照深拷贝产出新状态、不改写入参（R3 实测断言）；
   最短路步数与遍历顺序无关（R4 实测断言：两种 DIRS 顺序同解同步数）。

   【运行时异常处理（曦指令 2）】tryMove 抛出 / isWin 内部错误（window.__dslErr）一律记入
   错误探针：探索穷尽后若发生过任何运行时异常，结果只能 UNKNOWN（含不支持样本），禁止判 UNSAT。

   【vm 边界】沙箱只加载可信一方引擎代码；模型生成数据永不进入 vm 求值（VM1 测试断言沙箱无 Node 能力）。

   三值结果：PASS（solvable:true）/ UNSAT（false，完整穷举且零运行时异常）/ UNKNOWN（null）。
   独立性边界（L-3.3）：自动模型与运行时同源——PASS 是"候选路径"，真实通关证据须 GT-2a 重放。
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// 加载 Spike 游戏（mechanic.js / levels.js 为 const 声明，vm 沙箱求值后取出）
function loadSpikeGame(gameDir) {
  const mtext = fs.readFileSync(path.join(gameDir, 'mechanic.js'), 'utf8');
  const ltext = fs.readFileSync(path.join(gameDir, 'levels.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(mtext + '\n' + ltext + '\nthis.__out = { MECHANIC: MECHANIC, LEVELS: LEVELS };', sandbox);
  return { mechanic: sandbox.__out.MECHANIC, levels: sandbox.__out.LEVELS };
}

// 加载 DSL 运行时（只加载可信一方引擎代码；模型生成物永不进入 vm）
// 返回 { DSLRules, errProbe }——errProbe 读取运行时内部错误通道（window.__dslErr）
function loadRuntime(engineFile) {
  const code = fs.readFileSync(engineFile, 'utf8');
  const sandbox = { window: {}, performance: require('perf_hooks').performance };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return {
    DSLRules: sandbox.window.DSLRules,
    errProbe: {
      get: () => sandbox.window.__dslErr || null,
      clear: () => { sandbox.window.__dslErr = null; }
    }
  };
}

const DIRS = ['U', 'D', 'L', 'R'];

function stableKey(state) { return JSON.stringify(state); }

/* solveLevel(DSLRules, mechanic, level, opts?)
   opts.maxStates 默认 200000；opts.errProbe = { get, clear }（运行时错误探针——
   未传时记 probeMissing 标记并按无探针处理）。
   opts.dirsOrder 可注入遍历顺序（R4 不变性测试用）。
*/
function solveLevel(DSLRules, mechanic, level, opts) {
  const maxStates = (opts && opts.maxStates) || 200000;
  const dirs = (opts && opts.dirsOrder) || DIRS;
  const errProbe = (opts && opts.errProbe) || null;
  const probeMissing = !errProbe;
  const probe = errProbe || { get: () => null, clear: () => {} };

  const rules = DSLRules(mechanic, [level]);
  const start = rules.init(level, 0);
  const startKey = stableKey(start);
  const seen = new Set([startKey]);
  const parent = new Map();
  const queue = [{ key: startKey, state: start }];
  let states = 1;
  let errorCount = 0;
  const errorSamples = [];

  function noteError(kind, message) {
    errorCount++;
    const msg = String(message).slice(0, 160);
    if (errorSamples.length < 5 && !errorSamples.some(s => s.message === msg)) {
      errorSamples.push({ kind, message: msg });
    }
  }

  while (queue.length) {
    const { key, state } = queue.shift();

    // 胜利判断（先清错误通道，判断后读取——isWin 内部错误在此暴露，不静默吞掉）
    probe.clear();
    let win = false;
    try { win = !!rules.isWin(state, level); } catch (e) { noteError('isWin', e.message); }
    const winErr = probe.get();
    if (winErr) { noteError('isWin', winErr); win = false; }
    if (win) {
      const path = [];
      let cur = key;
      while (parent.has(cur)) { const p = parent.get(cur); path.push(p.dir); cur = p.from; }
      path.reverse();
      return { solvable: true, steps: path.length, path: path.join(''), probeMissing };
    }

    for (const dir of dirs) {
      let r;
      try { r = rules.tryMove(state, dir, level); }
      catch (e) { noteError('tryMove', e.message); continue; }   // 异常转移不计入状态空间
      if (!r || !r.moved) continue;
      const nk = stableKey(r.state);
      if (seen.has(nk)) continue;
      seen.add(nk);
      states++;
      parent.set(nk, { from: key, dir });
      if (states > maxStates) {
        return { solvable: null, unknownKind: 'state_exploded',
                 reason: 'UNKNOWN：超过状态上限 ' + maxStates + '（状态空间超限/可能无限，不算通过，禁止改写为 UNSAT）' };
      }
      queue.push({ key: nk, state: r.state });
    }
  }

  // 穷尽后的结论受运行时异常约束：发生过异常 ⇒ 只能 UNKNOWN + 不支持样本（曦指令 2）
  if (errorCount > 0) {
    return {
      solvable: null,
      unknownKind: 'runtime_errors',
      reason: 'UNKNOWN：探索中发生 ' + errorCount + ' 次运行时异常（存在不支持/出错语义，禁止判 UNSAT）',
      unsupported: errorSamples,
      errorCount,
      probeMissing
    };
  }
  return { solvable: false, reason: 'UNSAT：完整穷举可达状态空间后确认无解', errorCount, probeMissing };
}

module.exports = { loadSpikeGame, loadRuntime, solveLevel };
