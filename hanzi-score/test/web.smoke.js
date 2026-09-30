#!/usr/bin/env node
/**
 * 前端冒烟测试：用 jsdom 真实加载 index.html + app.js，
 * 走完「选图 → 拉正分割预览 → 点格子批改 → 渲染详情」的两步流程。
 *
 * 不起服务：fetch 被换成假的，直接喂 /api/prepare 与 /api/score_cell 的响应体，
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

const hidden = (node) => node.classList.contains('hidden');
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 造一份 /api/score_cell 的响应，score 决定走高分还是重写分支 */
function fakeResult(overrides) {
  return Object.assign({
    cell: 1,
    char: '木',
    target_char: null,
    char_match: null,
    total: 84,
    full_marks: 100,
    level: '良好',
    badge: '写得不错',
    emoji: '⭐',
    need_rewrite: false,
    rewrite_reason: '',
    rewrite_advice: null,
    improvements: ['整个字往下挪一点。', '竖要立直。'],
    dimensions: [
      { key: 'grid', name: '占格位置', score: 25, full: 30, comment: '稍微偏上' },
      { key: 'structure', name: '间架结构', score: 20, full: 25, comment: '间距匀称' },
      { key: 'stroke_shape', name: '笔画形态', score: 19, full: 25, comment: '竖有点斜' },
      { key: 'correctness', name: '笔画正确', score: 20, full: 20, comment: '笔画数对' }
    ],
    elapsed: 0.4,
    geometry: null,
    geometry_overlay: null,
    cell_image: 'data:image/jpeg;base64,CI'
  }, overrides || {});
}

/** /api/prepare 的响应：count 个格子 */
function fakePrepare(count) {
  return {
    id: 'pg0001',
    count,
    corrected: 'data:image/jpeg;base64,CORR',
    quads: Array.from({ length: count }, (_, i) => {
      const x = (i % 3) * 100;
      const y = Math.floor(i / 3) * 100;
      return [[x, y], [x + 90, y], [x + 90, y + 90], [x, y + 90]];
    }),
    width: 300,
    height: 600
  };
}

/**
 * 起一个装好页面的 jsdom 环境。
 * prepare 与 score_cell 的响应都由参数给定，fetch 全程不出网。
 */
function boot({ health, prepare, prepareStatus = 200, cellResults, cellStatus = 200 } = {}) {
  const dom = new JSDOM(HTML, {
    url: 'http://localhost:8360/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  const calls = { prepare: [], cell: [] };
  const prep = prepare !== undefined ? prepare : fakePrepare(2);

  // URL.createObjectURL / scrollIntoView：jsdom 没实现
  win.URL.createObjectURL = () => 'blob:fake';
  win.URL.revokeObjectURL = () => {};
  win.Element.prototype.scrollIntoView = function () {};

  win.fetch = (url, opts) => {
    if (/api\/health$/.test(String(url))) {
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(health || { status: 'ok' })
      });
    }
    if (/api\/prepare$/.test(String(url))) {
      calls.prepare.push(opts);
      const ok = prepareStatus === 200;
      return Promise.resolve({
        ok, status: prepareStatus,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(ok ? prep : { detail: '没找到田字格，把格子拍正再试' })
      });
    }
    if (/api\/score_cell$/.test(String(url))) {
      calls.cell.push(opts);
      const n = Number(opts.body.get('cell'));
      const ok = cellStatus === 200;
      const body = ok
        ? ((cellResults && cellResults[n]) || fakeResult({ cell: n }))
        : { detail: '笔迹太淡了，写重一点' };
      return Promise.resolve({
        ok, status: cellStatus,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(body)
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

/* ---------------- 用例 ---------------- */

const cases = [];
const it = (name, fn) => cases.push([name, fn]);

it('页面加载后识别按钮是禁用的', async () => {
  const { doc } = boot();
  await flush();
  assert(doc.getElementById('score-btn').disabled, '没选图就不该能点');
  assert(hidden(doc.getElementById('result')), '结果区初始应隐藏');
});

it('选好图后出现预览且可以识别', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc, { name: '木.png' });
  assert(!doc.getElementById('score-btn').disabled, '选好图应该能识别');
  assert(!hidden(doc.getElementById('preview-wrap')), '应显示预览');
  assert(hidden(doc.getElementById('drop-hint')), '预览后隐藏提示');
  assert(doc.getElementById('file-name').textContent === '木.png');
});

it('选了非图片文件会报错且不能识别', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc, { name: 'a.pdf', type: 'application/pdf' });
  assert(!hidden(doc.getElementById('error')), '应提示不是图片');
  assert(doc.getElementById('score-btn').disabled, '坏文件不该能识别');
});

it('超过八兆的图在前端就被拦下', async () => {
  const { win, doc } = boot();
  await flush();
  selectFile(win, doc, { size: 9 * 1024 * 1024 });
  const err = doc.getElementById('error');
  assert(!hidden(err), '应提示图片太大');
  assert(/8MB/.test(err.textContent), `提示要说清上限: ${err.textContent}`);
});

it('第一步：prepare 成功后显示拉正图和格子热区', async () => {
  const { win, doc, calls } = boot({ prepare: fakePrepare(4) });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();

  assert(calls.prepare.length === 1, '应调用一次 prepare');
  assert(calls.prepare[0].body.get('file'), '文件没提交上去');
  assert(!hidden(doc.getElementById('result')), '应切到预览态');
  assert(doc.getElementById('corrected-image').src === 'data:image/jpeg;base64,CORR',
    '拉正图没设上');
  const hots = doc.querySelectorAll('#cell-layer .cell-hot');
  assert(hots.length === 4, `应有 4 个格子热区，实际 ${hots.length}`);
  assert(hots[3].textContent === '4', '格子热区应标注序号');
  assert(/共 4 格/.test(doc.getElementById('page-hint').textContent), '应有提示');
  assert(hidden(doc.getElementById('detail')), '还没点格子不应显示详情');
  assert(/识别格子/.test(doc.getElementById('score-btn').textContent), '打完应恢复按钮');
});

it('单格照片 prepare 后自动批改', async () => {
  const { win, doc, calls } = boot({ prepare: fakePrepare(1) });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  await flush();

  assert(calls.cell.length === 1, '单格应自动批改一次');
  assert(calls.cell[0].body.get('page_id') === 'pg0001', '应带上页面 id');
  assert(doc.getElementById('score-num').textContent === '84', '详情应显示分数');
});

it('第二步：点格子才批改，结果着色并显示详情', async () => {
  const { win, doc, calls } = boot({
    prepare: fakePrepare(2),
    cellResults: {
      1: fakeResult({ cell: 1, total: 85 }),
      2: fakeResult({ cell: 2, total: 46, need_rewrite: true, level: '需重写',
                      badge: '再写一遍', emoji: '✏️',
                      rewrite_reason: '总分不到 60 分',
                      rewrite_advice: '擦掉再写一遍' })
    }
  });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  assert(calls.cell.length === 0, 'prepare 阶段不该打分');

  doc.getElementById('cell-2').click();
  await flush();
  await flush();

  assert(calls.cell.length === 1, '点格子才调 score_cell');
  assert(calls.cell[0].body.get('cell') === '2', '格号没传对');
  assert(doc.getElementById('score-num').textContent === '46', '详情应显示该格分数');
  assert(doc.getElementById('char-line').textContent.indexOf('第 2 格') >= 0,
    '详情应标注格号');
  assert(!hidden(doc.getElementById('rewrite')), '低分格应显示重写区块');
  assert(doc.getElementById('cell-2').classList.contains('bad'), '低分格子应标红');
  assert(doc.getElementById('cell-2').textContent.indexOf('2·46') >= 0,
    '格子热区应显示格号和分数');
  assert(/已批改 1 \/ 2 格/.test(doc.getElementById('page-hint').textContent),
    '提示应显示进度');
  assert(doc.getElementById('cell-2').classList.contains('active'), '当前格应高亮');

  // 再点同一格：不重复请求，直接切详情
  doc.getElementById('cell-2').click();
  await flush();
  assert(calls.cell.length === 1, '已批改的格子不应重复请求');

  // 点另一格：显示那格的详情
  doc.getElementById('cell-1').click();
  await flush();
  await flush();
  assert(calls.cell.length === 2, '第二格应发起批改');
  assert(doc.getElementById('score-num').textContent === '85', '详情应切到第 1 格');
  assert(doc.getElementById('cell-1').classList.contains('good'), '高分格子应标绿');
  assert(hidden(doc.getElementById('rewrite')), '高分格不显示重写区块');
});

it('格子批改报错时热区变灰并提示原因', async () => {
  const { win, doc } = boot({ prepare: fakePrepare(2), cellStatus: 422 });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  doc.getElementById('cell-1').click();
  await flush();
  await flush();

  const div = doc.getElementById('cell-1');
  assert(div.classList.contains('err'), '报错格子应变灰');
  assert(div.textContent.indexOf('✗') >= 0, '报错格子应标 ✗');
  assert(/笔迹太淡/.test(doc.getElementById('page-hint').textContent),
    '提示应带服务端原因');
  assert(hidden(doc.getElementById('detail')), '没有结果就不显示详情');
});

it('prepare 报错时把服务端说明显示出来', async () => {
  const { win, doc } = boot({ prepareStatus: 400 });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();

  const err = doc.getElementById('error');
  assert(!hidden(err), '应显示错误');
  assert(/没找到田字格/.test(err.textContent), `错误文案不对: ${err.textContent}`);
  assert(hidden(doc.getElementById('result')), '失败时不该显示预览区');
});

it('识别期间按钮置灰打完恢复，重复点击只发一次', async () => {
  const { win, doc, calls } = boot();
  await flush();
  selectFile(win, doc);
  const btn = doc.getElementById('score-btn');

  btn.click();
  assert(btn.disabled, '识别中按钮必须置灰，防重复提交');
  assert(/正在找格子/.test(btn.textContent), `等待态文案不对: ${btn.textContent}`);

  btn.click();  // 等待中再点一次，不应重复提交
  await flush();
  assert(calls.prepare.length === 1, `重复点击提交了 ${calls.prepare.length} 次`);
  assert(!btn.disabled, '打完应恢复可点');
  assert(btn.textContent === '识别格子', '打完文案应复原');
});

it('带几何结果的格子显示手写与标准并排对比和分层叠加图', async () => {
  const { win, doc } = boot({
    prepare: fakePrepare(2),
    cellResults: {
      1: fakeResult({
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
    }
  });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  doc.getElementById('cell-1').click();
  await flush();
  await flush();

  const geo = doc.getElementById('geometry');
  assert(!hidden(geo), '有几何结果应显示区块');
  const rows = doc.querySelectorAll('#geometry-rows li');
  assert(rows.length === 2, `几何行应有 2 条，实际 ${rows.length}`);
  assert(/偏右 5%/.test(rows[0].textContent), '几何行内容不对');
  // 左边是这一格自己的裁剪图（不是整张原图）
  assert(doc.getElementById('geometry-original').src === 'data:image/jpeg;base64,CI',
    '并排的格子手写图没设上');
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
  assert(redBtn.classList.contains('active'), '点红后红按钮应高亮');
  // 只看标准：与颜色单选互斥，进入时其它按钮变灰
  const stdBtn = doc.getElementById('btn-standard');
  stdBtn.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert(doc.getElementById('geometry-ink').style.display === 'none', '只看标准应隐藏手写层');
  assert(doc.getElementById('geometry-std').style.display === '', '只看标准应显示标准字形层');
  assert(stdBtn.classList.contains('active'), '只看标准按钮应高亮');
  assert(redBtn.classList.contains('dim'), '只看标准时红按钮应变灰');
  // 灰着的按钮仍可点击：点绿退出只看标准并切到绿
  doc.querySelector('#layer-btns [data-layer="green"]')
    .dispatchEvent(new win.Event('click', { bubbles: true }));
  assert(!stdBtn.classList.contains('active'), '点颜色后只看标准应退出');
  assert(doc.getElementById('geometry-layer-green').style.display === '', '退出后应显示绿档');
  assert(doc.getElementById('geometry-layer-red').style.display === 'none', '退出后红档应隐藏');
  // 全部
  doc.querySelector('#layer-btns [data-layer="all"]')
    .dispatchEvent(new win.Event('click', { bubbles: true }));
  assert(doc.getElementById('geometry-layer-red').style.display === '', '全部应恢复红层');
  assert(doc.querySelector('#layer-btns [data-layer="all"]').classList.contains('active'),
    '全部应高亮');
});

it('没有几何结果的格子隐藏对比区块', async () => {
  const { win, doc } = boot({ prepare: fakePrepare(2) });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  doc.getElementById('cell-1').click();
  await flush();
  await flush();
  assert(hidden(doc.getElementById('geometry')), 'geometry 为 null 时应隐藏');
});

it('换一张会清空预览、格子层和结果', async () => {
  const { win, doc } = boot({ prepare: fakePrepare(2) });
  await flush();
  selectFile(win, doc);
  doc.getElementById('score-btn').click();
  await flush();
  assert(!hidden(doc.getElementById('result')));

  doc.getElementById('reset-btn').click();
  assert(hidden(doc.getElementById('result')), '换图后结果应清空');
  assert(hidden(doc.getElementById('preview-wrap')), '换图后预览应隐藏');
  assert(doc.getElementById('score-btn').disabled, '换图后未选图不能识别');
  assert(doc.querySelectorAll('#cell-layer .cell-hot').length === 0, '格子层应清空');
  assert(doc.getElementById('corrected-image').getAttribute('src') === null,
    '拉正图应清掉');
});

/* ---------------- 运行 ---------------- */

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
