#!/usr/bin/env node
/**
 * 前端冒烟测试：用 jsdom 真实加载 index.html + app.js，
 * 走完「选图 → 打分 → 渲染结果」，确认低分时重写区块真的会出现。
 *
 * 不起服务：fetch 被换成假的，直接喂 /api/score 的响应体，
 * 所以这个测试验证的是页面渲染逻辑，不是接口（接口那边用 curl 验过）。
 *
 * 需要 jsdom：
 *   cd /tmp && npm install jsdom --no-save
 *   node hanzi-score/test/web.smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
try {
  ({ JSDOM } = require(require.resolve('jsdom', { paths: ['/tmp/node_modules'] })));
} catch (e) {
  try {
    ({ JSDOM } = require('jsdom'));
  } catch (e2) {
    console.error('缺少 jsdom。先装：cd /tmp && npm install jsdom --no-save');
    process.exit(2);
  }
}

const STATIC_DIR = path.join(__dirname, '..', 'server', 'static');
const HTML = fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(STATIC_DIR, 'app.js'), 'utf8');

let passed = 0;
const failed = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed.push([name, err.message]);
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

/** 造一份 /api/score 的响应，score 决定走高分还是重写分支 */
function fakeResult(overrides) {
  return Object.assign({
    char: '木',
    target_char: '木',
    char_match: true,
    total: 84,
    full_marks: 100,
    level: '良好',
    badge: '写得不错',
    emoji: '⭐',
    need_rewrite: false,
    rewrite_reason: '',
    rewrite_advice: null,
    praise: '横写得又平又稳！',
    improvements: ['整个字往下挪一点。', '竖要立直。'],
    dimensions: [
      { key: 'grid', name: '占格位置', score: 25, full: 30, comment: '稍微偏上' },
      { key: 'structure', name: '间架结构', score: 20, full: 25, comment: '间距匀称' },
      { key: 'stroke_shape', name: '笔画形态', score: 19, full: 25, comment: '竖有点斜' },
      { key: 'correctness', name: '笔画正确', score: 20, full: 20, comment: '笔画数对' }
    ],
    elapsed: 0.4,
    geometry: null,
    geometry_overlay: null
  }, overrides || {});
}

/**
 * 起一个装好页面的 jsdom 环境。
 * health 与 score 的响应都由参数给定，fetch 全程不出网。
 */
function boot({ health, scoreResult, scoreStatus = 200 } = {}) {
  const dom = new JSDOM(HTML, {
    url: 'http://localhost:8360/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  const calls = { score: [] };

  // URL.createObjectURL / revokeObjectURL：jsdom 没实现
  win.URL.createObjectURL = () => 'blob:fake';
  win.URL.revokeObjectURL = () => {};

  // scrollIntoView：jsdom 没实现
  win.Element.prototype.scrollIntoView = function () {};

  win.fetch = (url, opts) => {
    // 页面里用的是相对路径（兼容直连与反向代理前缀），按结尾匹配
    if (/api\/health$/.test(String(url))) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(health || { status: 'ok', mode: 'local' })
      });
    }
    if (/api\/score$/.test(String(url))) {
      calls.score.push(opts);
      return Promise.resolve({
        ok: scoreStatus === 200,
        status: scoreStatus,
        json: () => Promise.resolve(scoreStatus === 200 ? (scoreResult || fakeResult())
                                                       : { detail: '图片打不开，换一张试试' })
      });
    }
    return Promise.reject(new Error('unexpected url ' + url));
  };

  win.eval(APP_JS);
  return { win, doc: win.document, calls };
}

/** 把一个假 File 塞进 file input 并触发 change */
function selectFile(win, doc, { name = 'a.png', type = 'image/png', size = 1024 } = {}) {
  const input = doc.getElementById('file-input');
  const file = new win.File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new win.Event('change'));
}

/** 等 fetch 的 promise 链跑完 */
const flush = () => new Promise((r) => setTimeout(r, 0));

const hidden = (node) => node.classList.contains('hidden');

/* ---------------- 用例 ---------------- */

const cases = [];
const it = (name, fn) => cases.push([name, fn]);

it('页面加载后打分按钮是禁用的', async () => {
  const { doc } = boot();
  await flush();
  assert(doc.getElementById('score-btn').disabled, '没选图就不该能点打分');
  assert(hidden(doc.getElementById('result')), '结果区初始应隐藏');
});

it('选好图后出现预览且可以打分', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc, { name: '木.png' });
  assert(!doc.getElementById('score-btn').disabled, '选好图应该能打分');
  assert(!hidden(doc.getElementById('preview-wrap')), '应显示预览');
  assert(hidden(doc.getElementById('drop-hint')), '预览后隐藏提示');
  assert(doc.getElementById('file-name').textContent === '木.png');
});

it('选了非图片文件会报错且不能打分', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc, { name: 'a.pdf', type: 'application/pdf' });
  assert(!hidden(doc.getElementById('error')), '应提示不是图片');
  assert(doc.getElementById('score-btn').disabled, '坏文件不该能打分');
});

it('超过八兆的图在前端就被拦下', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc, { size: 9 * 1024 * 1024 });
  const err = doc.getElementById('error');
  assert(!hidden(err), '应提示图片太大');
  assert(/8MB/.test(err.textContent), `提示要说清上限: ${err.textContent}`);
});

it('高分结果渲染出分数等级和四条维度', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();

  assert(!hidden(doc.getElementById('result')), '结果区应显示');
  assert(doc.getElementById('score-num').textContent === '84', '总分渲染错');
  assert(/写得不错/.test(doc.getElementById('level-badge').textContent), '等级徽章渲染错');

  const dims = doc.querySelectorAll('#dims .dim');
  assert(dims.length === 4, `应有 4 条维度，实际 ${dims.length}`);
  assert(/占格位置/.test(dims[0].textContent) && /25 \/ 30/.test(dims[0].textContent),
    `维度行内容不对: ${dims[0].textContent}`);

  const items = doc.querySelectorAll('#improvements li');
  assert(items.length === 2, `改进点应有 2 条，实际 ${items.length}`);
  assert(hidden(doc.getElementById('rewrite')), '高分不该出现重写区块');
  assert(!doc.getElementById('result').classList.contains('need-rewrite'));
});

it('低于六十分显示重写区块和重写建议', async () => {
  const { win, doc } = boot({
    scoreResult: fakeResult({
      total: 46,
      level: '需重写',
      badge: '再写一遍',
      emoji: '✏️',
      need_rewrite: true,
      rewrite_reason: '总分不到 60 分',
      rewrite_advice: '擦掉再写一遍，这次把字写在格子正中间。',
      dimensions: [
        { key: 'grid', name: '占格位置', score: 12, full: 30, comment: '顶出格子' },
        { key: 'structure', name: '间架结构', score: 11, full: 25, comment: '重心歪' },
        { key: 'stroke_shape', name: '笔画形态', score: 9, full: 25, comment: '竖弯了' },
        { key: 'correctness', name: '笔画正确', score: 14, full: 20, comment: '有一笔像别的' }
      ]
    })
  });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();

  const rewrite = doc.getElementById('rewrite');
  assert(!hidden(rewrite), '低分必须显示重写区块');
  assert(/总分不到 60 分/.test(doc.getElementById('rewrite-reason').textContent), '重写原因没渲染');
  assert(/擦掉再写一遍/.test(doc.getElementById('rewrite-advice').textContent), '重写建议没渲染');
  assert(doc.getElementById('result').classList.contains('need-rewrite'),
    '结果卡要切到重写配色');
  // 低分维度条应带 low 类（红色）
  assert(doc.querySelector('#dims .dim-fill.low'), '低分维度条应标红');
});

it('需重写但模型没给建议时前端有兜底话术', async () => {
  const { win, doc } = boot({
    scoreResult: fakeResult({ total: 50, need_rewrite: true, rewrite_reason: '', rewrite_advice: null })
  });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  assert(doc.getElementById('rewrite-advice').textContent.trim().length > 0,
    '缺建议时不能留空白');
});

it('只提交图片，不带目标字字段', async () => {
  const { win, doc, calls } = boot();
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();

  assert(calls.score.length === 1, '应提交一次');
  const form = calls.score[0].body;
  assert(!form.has('target_char'), '不该再提交目标字字段');
  assert(form.get('file'), '文件没提交上去');
});

it('带几何结果时显示照片与标准并排对比和分层叠加图', async () => {
  const { win, doc } = boot({
    scoreResult: fakeResult({
      geometry: {
        ok: true, char: '木',
        lines: ['占格：字的中心偏右 5%', '贴合：平均每笔偏离标准位置约 2% 格宽'],
        recognized: null, metrics: {}
      },
      geometry_overlay: {
        grid: 'data:image/png;base64,G',
        green: 'data:image/png;base64,Gr',
        green_cl: 'data:image/png;base64,Gc',
        yellow: null,
        red: 'data:image/png;base64,R',
        red_cl: 'data:image/png;base64,Rc',
        std: 'data:image/png;base64,S',
        ink: 'data:image/png;base64,I'
      }
    })
  });
  await flush();
  selectFile(win, doc, { name: '木.png' });
  doc.getElementById('score-btn').click();
  await flush();

  const geo = doc.getElementById('geometry');
  assert(!hidden(geo), '有几何结果应显示区块');
  const rows = doc.querySelectorAll('#geometry-rows li');
  assert(rows.length === 2, `几何行应有 2 条，实际 ${rows.length}`);
  assert(/偏右 5%/.test(rows[0].textContent), '几何行内容不对');
  // 并排：左边原图（取自预览 objectURL），右边分层叠加
  assert(doc.getElementById('geometry-original').src.length > 0, '并排的原图没设上');
  assert(doc.getElementById('geometry-grid').src === 'data:image/png;base64,G', '米字格层没设上');
  assert(doc.getElementById('geometry-ink').src === 'data:image/png;base64,I', '手写层没设上');
  assert(doc.getElementById('geometry-layer-green').src === 'data:image/png;base64,Gr', '绿层没设上');
  assert(doc.getElementById('geometry-cl-green').src === 'data:image/png;base64,Gc', '绿档中线层没设上');
  // 没有黄色档笔画 → 黄色按钮置灰不可点；默认「全部」高亮
  const yellowBtn = doc.querySelector('#layer-btns [data-layer="yellow"]');
  assert(yellowBtn.disabled, '没有黄色档时按钮应禁用');
  assert(doc.getElementById('geometry-layer-green').style.display === '', '全部档位默认显示');
  assert(doc.querySelector('#layer-btns [data-layer="all"]').classList.contains('active'),
    '默认「全部」高亮');
  // 单选：点红只亮红，红档显示、绿档隐藏
  const redBtn = doc.querySelector('#layer-btns [data-layer="red"]');
  redBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert(doc.getElementById('geometry-layer-red').style.display === '', '点红后红层应显示');
  assert(doc.getElementById('geometry-cl-red').style.display === '', '点红后红档中线应显示');
  assert(doc.getElementById('geometry-layer-green').style.display === 'none', '点红后绿层应隐藏');
  assert(doc.getElementById('geometry-cl-green').style.display === 'none', '点红后绿档中线应隐藏');
  assert(redBtn.classList.contains('active'), '点红后红按钮应高亮');
  assert(!doc.querySelector('#layer-btns [data-layer="all"]').classList.contains('active'),
    '选红后「全部」不应高亮');
  // 只看标准：与颜色单选互斥，进入时其它按钮变灰
  const stdBtn = doc.getElementById('btn-standard');
  stdBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert(doc.getElementById('geometry-ink').style.display === 'none', '只看标准应隐藏手写层');
  assert(doc.getElementById('geometry-std').style.display === '', '只看标准应显示标准字形层');
  assert(doc.getElementById('geometry-layer-red').style.display === 'none',
    '只看标准应隐藏彩色层');
  assert(stdBtn.classList.contains('active'), '只看标准按钮应高亮');
  assert(redBtn.classList.contains('dim'), '只看标准时红按钮应变灰');
  assert(!redBtn.classList.contains('active'), '只看标准时红按钮不应高亮');
  // 灰着的按钮仍可点击：点绿退出只看标准并切到绿
  doc.querySelector('#layer-btns [data-layer="green"]')
    .dispatchEvent(new win.Event('click', { bubbles: true }));
  assert(!stdBtn.classList.contains('active'), '点颜色后只看标准应退出');
  assert(doc.getElementById('geometry-ink').style.display === '', '退出后手写应恢复');
  assert(doc.getElementById('geometry-std').style.display === 'none', '退出后标准层应隐藏');
  assert(doc.getElementById('geometry-layer-green').style.display === '', '退出后应显示绿档');
  assert(doc.getElementById('geometry-layer-red').style.display === 'none', '退出后红档应隐藏');
  // 全部
  doc.querySelector('#layer-btns [data-layer="all"]')
    .dispatchEvent(new win.Event('click', { bubbles: true }));
  assert(doc.getElementById('geometry-layer-green').style.display === '', '全部应恢复绿层');
  assert(doc.getElementById('geometry-layer-red').style.display === '', '全部应恢复红层');
  assert(doc.querySelector('#layer-btns [data-layer="all"]').classList.contains('active'),
    '全部应高亮');
  assert(!doc.querySelector('#layer-btns [data-layer="green"]').classList.contains('active'),
    '全部时绿不应高亮');
});

it('没带几何结果时隐藏程序量了量区块', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  assert(hidden(doc.getElementById('geometry')), 'geometry 为 null 时应隐藏');
});

it('多格结果按格子列分数，点一个显示那个格的详情', async () => {
  const base = fakeResult({});
  const { win, doc } = boot({
    scoreResult: {
      count: 2,
      results: [
        Object.assign({}, base, { cell: 1, total: 80, char: '汉' }),
        Object.assign({}, base, { cell: 2, total: 40, char: '字',
                                  need_rewrite: true })
      ]
    }
  });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();

  const list = doc.getElementById('cell-list');
  assert(!hidden(list), '多格时应显示格子列表');
  const rows = list.querySelectorAll('.cell-row');
  assert(rows.length === 2, `应有 2 个格子按钮，实际 ${rows.length}`);
  assert(/80 分/.test(rows[0].textContent) && /汉|优秀|写得不错/.test(rows[0].textContent),
    '格子按钮应带分数和等级');
  assert(/✏️/.test(rows[1].textContent), '需重写的格子应有标记');
  assert(doc.getElementById('score-num').textContent === '80', '默认显示第 1 格');
  // 点第 2 格切换详情
  rows[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  assert(doc.getElementById('score-num').textContent === '40', '点第 2 格应切换详情');
  assert(rows[1].classList.contains('active') && !rows[0].classList.contains('active'),
    '高亮应跟随切换');
  assert(doc.getElementById('result').classList.contains('need-rewrite'),
    '切到需重写的格子后结果卡应有重写样式');
});

it('接口报错时把服务端的说明显示出来', async () => {  const { win, doc } = boot({ scoreStatus: 400 });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();

  const err = doc.getElementById('error');
  assert(!hidden(err), '应显示错误');
  assert(/图片打不开/.test(err.textContent), `错误文案不对: ${err.textContent}`);
  assert(hidden(doc.getElementById('result')), '失败时不该显示结果区');
});

it('打分期间按钮置灰打完恢复', async () => {
  const { win, doc, calls } = boot();
  await flush();
  selectFile(win, doc);
  const btn = doc.getElementById('score-btn');

  btn.click();
  assert(btn.disabled, '打分中按钮必须置灰，防重复提交');
  assert(/老师正在看/.test(btn.textContent), `等待态文案不对: ${btn.textContent}`);

  btn.click();  // 等待中再点一次，不应重复提交
  await flush();
  assert(calls.score.length === 1, `重复点击提交了 ${calls.score.length} 次`);
  assert(!btn.disabled, '打完应恢复可点');
  assert(btn.textContent === '开始打分', '打完文案应复原');
});

it('换一张会清空预览和结果', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  assert(!hidden(doc.getElementById('result')));

  doc.getElementById('reset-btn').click();
  assert(hidden(doc.getElementById('result')), '换图后结果应清空');
  assert(hidden(doc.getElementById('preview-wrap')), '换图后预览应隐藏');
  assert(doc.getElementById('score-btn').disabled, '换图后未选图不能打分');
});

(async () => {
  console.log('前端冒烟测试（jsdom）');
  for (const [name, fn] of cases) {
    let err = null;
    try {
      await fn();
    } catch (e) {
      err = e;
    }
    if (err) {
      failed.push([name, err.message]);
      console.log(`  ✗ ${name}: ${err.message}`);
    } else {
      passed++;
      console.log(`  ✓ ${name}`);
    }
  }
  console.log(`\n通过 ${passed} 项，失败 ${failed.length} 项`);
  process.exit(failed.length ? 1 : 0);
})();
