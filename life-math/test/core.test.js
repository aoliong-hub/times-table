// core.test.js - 核心逻辑自测（node life-math/test/core.test.js）
const assert = require('assert');
const Questions = require('../miniprogram/core/questions.js');
const Game = require('../miniprogram/core/game.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

// 固定种子随机数，保证测试可复现
function seeded(seed) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

console.log('questions.js');

test('中文数字转换', () => {
  assert.strictEqual(Questions.num2cn(5), '五');
  assert.strictEqual(Questions.num2cn(10), '十');
  assert.strictEqual(Questions.num2cn(12), '十二');
  assert.strictEqual(Questions.num2cn(20), '二十');
  assert.strictEqual(Questions.num2cn(45), '四十五');
});

test('乘法口诀读法', () => {
  assert.strictEqual(Questions.chantOf(2, 3), '二三得六');
  assert.strictEqual(Questions.chantOf(2, 5), '二五一十');
  assert.strictEqual(Questions.chantOf(5, 2), '二五一十');
  assert.strictEqual(Questions.chantOf(3, 4), '三四十二');
  assert.strictEqual(Questions.chantOf(9, 9), '九九八十一');
  assert.strictEqual(Questions.chantOf(10, 3), ''); // 超出九九表
});

test('五个关卡都能出题，且题目字段完整', () => {
  assert.strictEqual(Questions.levels.length, 5);
  Questions.levels.forEach((lv, i) => {
    const list = Questions.buildLevel(lv.id, { rng: seeded(i + 1) });
    assert.strictEqual(list.length, lv.count, lv.id + ' 题目数量');
    list.forEach(q => {
      assert.ok(q.text.length > 0, 'text');
      assert.strictEqual(q.answer, q.per * q.groups, '答案 = 每份 × 份数');
      assert.strictEqual(q.options.length, 4, '四个选项');
      assert.ok(q.options.indexOf(q.answer) !== -1, '选项含正确答案');
      assert.strictEqual(new Set(q.options).size, 4, '选项不重复');
      q.options.forEach(o => assert.ok(o > 0, '选项为正数'));
      assert.ok(q.groups >= 2, '份数至少 2（才有乘法意义）');
    });
  });
});

test('同一关不出现重复题，难度递增', () => {
  Questions.levels.forEach((lv, i) => {
    const list = Questions.buildLevel(lv.id, { rng: seeded(100 + i) });
    const keys = list.map(q => q.key + ':' + q.groups);
    assert.strictEqual(new Set(keys).size, keys.length, lv.id + ' 无重复题');
    for (let k = 1; k < list.length; k++) {
      assert.ok(list[k].answer >= list[k - 1].answer, lv.id + ' 答案递增');
    }
  });
});

test('加法展开与口诀只在合适的题上出现', () => {
  const list = Questions.buildLevel('clock', { rng: seeded(7) });
  list.forEach(q => {
    if (q.addition) {
      const sum = q.addition.split('=')[0].split('+').reduce((a, b) => a + Number(b), 0);
      assert.strictEqual(sum, q.answer, '加法展开之和 = 答案');
    }
    if (q.per <= 9 && q.groups <= 9) assert.ok(q.chant.length > 0, '九九表内应有口诀');
  });
});

test('未知关卡返回空数组', () => {
  assert.deepStrictEqual(Questions.buildLevel('nope'), []);
  assert.strictEqual(Questions.getLevel('nope'), null);
});

console.log('game.js');

test('全部一次答对拿满分和三星', () => {
  const g = Game.create('money', { rng: seeded(3) });
  const max = g.maxScore();
  while (!g.finished) {
    g.answer(g.current().answer);
  }
  const r = g.result();
  assert.strictEqual(r.score, max, '满分');
  assert.strictEqual(r.stars, 3);
  assert.strictEqual(r.rightCount, r.total);
  assert.strictEqual(r.wrongCount, 0);
  assert.strictEqual(r.bestCombo, r.total);
});

test('连对奖励递增且封顶 +20', () => {
  const g = Game.create('life', { rng: seeded(4), count: 8 });
  const gains = [];
  while (!g.finished) gains.push(g.answer(g.current().answer).gain);
  assert.deepStrictEqual(gains, [15, 20, 25, 30, 35, 35, 35, 35]);
});

test('第一次答错还有一次机会，题目不前进', () => {
  const g = Game.create('week', { rng: seeded(5) });
  const q = g.current();
  const r1 = g.answer(q.answer + 1);
  assert.strictEqual(r1.correct, false);
  assert.strictEqual(r1.retry, true);
  assert.strictEqual(r1.revealed, false);
  assert.strictEqual(g.current(), q, '仍是同一题');
  assert.strictEqual(g.score, 0);

  const r2 = g.answer(q.answer);
  assert.strictEqual(r2.correct, true);
  assert.strictEqual(r2.gain, 10, '第二次答对没有首次奖励');
  assert.notStrictEqual(g.current(), q, '进入下一题');
  assert.strictEqual(g.rightCount, 0, '不计入一次答对');
});

test('两次都错则公布答案并断掉连对', () => {
  const g = Game.create('calendar', { rng: seeded(6) });
  g.answer(g.current().answer); // 先连对一题
  assert.strictEqual(g.combo, 1);

  const q = g.current();
  g.answer(q.answer + 1);
  const r = g.answer(q.answer + 2);
  assert.strictEqual(r.correct, false);
  assert.strictEqual(r.retry, false);
  assert.strictEqual(r.revealed, true);
  assert.strictEqual(r.answer, q.answer, '公布正确答案');
  assert.strictEqual(g.combo, 0, '连对清零');
  assert.strictEqual(g.wrongCount, 1);
  assert.strictEqual(g.bestCombo, 1, '最佳连对保留');
});

test('全部答错得 0 分 0 星', () => {
  const g = Game.create('clock', { rng: seeded(8) });
  while (!g.finished) {
    const q = g.current();
    g.answer(q.answer + 1);
    g.answer(q.answer + 2);
  }
  const r = g.result();
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.stars, 0);
  assert.strictEqual(r.wrongCount, r.total);
});

test('答完后继续作答不会越界', () => {
  const g = Game.create('money', { rng: seeded(9) });
  while (!g.finished) g.answer(g.current().answer);
  const r = g.answer(1);
  assert.strictEqual(r.finished, true);
  assert.strictEqual(r.gain, 0);
  assert.strictEqual(g.current(), null);
});

test('星级按得分率划档', () => {
  assert.strictEqual(Game.starsOf(100, 100), 3);
  assert.strictEqual(Game.starsOf(90, 100), 3);
  assert.strictEqual(Game.starsOf(70, 100), 2);
  assert.strictEqual(Game.starsOf(40, 100), 1);
  assert.strictEqual(Game.starsOf(10, 100), 0);
  assert.strictEqual(Game.starsOf(0, 0), 0);
});

console.log('\n全部通过：' + passed + ' 项');
