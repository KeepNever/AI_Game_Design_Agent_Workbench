'use strict';
/* 一次性工具：从可信产物产出工作台 Mock 候选（运行一次即弃）。
   候选来源全部为已过闸门的既有产物——Spike 四机制 / e2e 演示候选，仅改标题做变体。 */
const fs = require('fs');
const path = require('path');
const { loadSpikeGame } = require('../../validator/solver.js');

const SPIKE = path.join(__dirname, '..', '..', '..', '11_Spike_网格解谜');
const OUT = path.join(__dirname, 'mock-candidates');

function fence(env) { return '```json\n' + JSON.stringify(env) + '\n```'; }

function dump(spikeId, outId, title) {
  const g = loadSpikeGame(path.join(SPIKE, spikeId));
  const mech = JSON.parse(JSON.stringify(g.mechanic));
  if (title) mech.title = title;
  const env = { dsl_version: 'grid-puzzle/0.1', mechanic: mech, levels: g.levels };
  fs.writeFileSync(path.join(OUT, outId + '.json'), JSON.stringify({ content: fence(env) }, null, 1), 'utf8');
  console.log(outId, '<-', spikeId, '| levels:', g.levels.length, '| title:', mech.title);
}

dump('gameA_推箱', 'tune-a');
dump('gameB_钥匙门', 'tune-b');
dump('gameC_碎裂地板', 'tune-c');
dump('gameD_开关闸门', 'tune-d');
dump('gameB_钥匙门', 'tune-f', '三钥匙连环门');
dump('gameC_碎裂地板', 'tune-g', '碎裂回廊');

// tune-e：按序踩灯（e2e 演示候选原样复用）
const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'e2e', 'candidate-glm5-demo.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'tune-e.json'), JSON.stringify({ content: demo.content }, null, 1), 'utf8');
console.log('tune-e <- e2e candidate-glm5-demo');

// tune-f 首回合失败注入：合法信封 + win 含未知函数（Schema 闸门 UNKNOWN_FUNCTION 拦截 → 演示重试）
const goodF = JSON.parse(fs.readFileSync(path.join(OUT, 'tune-f.json'), 'utf8'));
const envF = JSON.parse(goodF.content.replace(/^```json\n/, '').replace(/\n```$/, ''));
const badEnv = JSON.parse(JSON.stringify(envF));
badEnv.mechanic.win = badEnv.mechanic.win + ' && unknownFn()';
fs.writeFileSync(path.join(OUT, 'tune-f-attempt1.json'), JSON.stringify({ content: fence(badEnv) }, null, 1), 'utf8');
console.log('tune-f-attempt1 <- tune-f + UNKNOWN_FUNCTION 注入');
