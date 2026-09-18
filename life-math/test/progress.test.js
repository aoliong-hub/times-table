// progress.test.js - 进度存储自测（node life-math/test/progress.test.js）
const assert = require('assert');
const Progress = require('../miniprogram/core/progress.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

// 内存版 storage 适配器，模拟 wx.getStorageSync / localStorage
function memStore() {
  const box = {};
  return {
    get(key) { return box[key] || null; },
    set(key, value) { box[key] = value; }
  };
}

console.log('progress.js');

test('未注入适配器时读到空进度，不抛异常', () => {
  assert.deepStrictEqual(Progress.all(), {});
  assert.deepStrictEqual(Progress.of('clock'), { stars: 0, best: 0 });
  assert.strictEqual(Progress.totalStars(), 0);
});

test('保存后能读回', () => {
  Progress.use(memStore());
  Progress.save('clock', { score: 120, stars: 2 });
  assert.deepStrictEqual(Progress.of('clock'), { stars: 2, best: 120 });
  assert.strictEqual(Progress.totalStars(), 2);
});

test('成绩变差不覆盖已有记录', () => {
  Progress.use(memStore());
  Progress.save('money', { score: 200, stars: 3 });
  Progress.save('money', { score: 50, stars: 1 });
  assert.deepStrictEqual(Progress.of('money'), { stars: 3, best: 200 });
});

test('成绩变好才更新', () => {
  Progress.use(memStore());
  Progress.save('week', { score: 80, stars: 1 });
  Progress.save('week', { score: 150, stars: 3 });
  assert.deepStrictEqual(Progress.of('week'), { stars: 3, best: 150 });
});

test('多关星数累加，reset 清空', () => {
  Progress.use(memStore());
  Progress.save('clock', { score: 100, stars: 3 });
  Progress.save('money', { score: 90, stars: 2 });
  Progress.save('life', { score: 40, stars: 1 });
  assert.strictEqual(Progress.totalStars(), 6);
  Progress.reset();
  assert.strictEqual(Progress.totalStars(), 0);
  assert.deepStrictEqual(Progress.of('clock'), { stars: 0, best: 0 });
});

test('存储返回脏数据时降级为空进度', () => {
  Progress.use({ get() { return 'not-an-object'; }, set() {} });
  assert.deepStrictEqual(Progress.all(), {});
  assert.deepStrictEqual(Progress.of('clock'), { stars: 0, best: 0 });
});

console.log('\n全部通过：' + passed + ' 项');
