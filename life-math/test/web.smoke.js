// web.smoke.js - 浏览器预览版冒烟测试：真实加载 web/index.html，走完一整关
//
// 需要 jsdom（本项目本身零依赖，所以装到项目外即可）：
//   cd /tmp && npm install jsdom --no-save
//   node life-math/test/web.smoke.js
// 未安装时本脚本直接跳过，不算失败。
//
// 注意：jsdom 在 file:// 源下禁用 localStorage，所以这里起一个临时 http 服务加载页面。

let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  try {
    JSDOM = require('/tmp/node_modules/jsdom').JSDOM;
  } catch (e2) {
    console.log('跳过：未安装 jsdom（cd /tmp && npm install jsdom --no-save）');
    process.exit(0);
  }
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, req.url.split('?')[0]);
  if (p.indexOf(ROOT) !== 0 || !fs.existsSync(p)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'text/plain' });
  res.end(fs.readFileSync(p));
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

server.listen(0, async () => {
  const port = server.address().port;
  const dom = await JSDOM.fromURL(`http://localhost:${port}/web/index.html`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true
  });
  const win = dom.window;
  const doc = win.document;
  const errors = [];
  win.addEventListener('error', e => errors.push(e.message));
  await sleep(500);

  // 玩完一关。allCorrect=false 时每题故意点错两次
  async function playLevel(levelIdx, allCorrect) {
    doc.querySelectorAll('#levelList .level')[levelIdx]
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    let guard = 0;
    while (doc.getElementById('screen-play').classList.contains('active') && guard++ < 300) {
      const g = win.Preview.game;
      if (g.current() && !win.Preview.locked) {
        const ans = String(g.current().answer);
        const btn = [].slice.call(doc.querySelectorAll('.option')).filter(b => {
          if (b.disabled) return false;
          const isAnswer = b.querySelector('.option-num').textContent === ans;
          return allCorrect ? isAnswer : !isAnswer;
        })[0];
        if (btn) btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      }
      await sleep(250);
    }
    assert.ok(doc.getElementById('screen-result').classList.contains('active'), '应进入成绩页');
  }

  // 1. 关卡地图
  const levels = doc.querySelectorAll('#levelList .level');
  assert.strictEqual(levels.length, 5, '应有 5 个关卡');
  assert.ok(/⭐ 0 \/ 15/.test(doc.getElementById('totalStars').textContent), '初始 0 星');
  console.log('✓ 地图渲染 5 关：' +
    [].slice.call(levels).map(l => l.querySelector('.level-name').textContent).join('、'));

  // 2. 进入第 1 关，检查题面三要素：题目 / 图示 / 四选项
  levels[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.ok(doc.getElementById('screen-play').classList.contains('active'), '应切到答题页');
  assert.ok(doc.getElementById('questionText').textContent.length > 5, '有题目文字');
  assert.strictEqual(doc.querySelectorAll('#options .option').length, 4, '四个选项');
  assert.ok(doc.querySelectorAll('#groups .group').length >= 2, '图示至少 2 组');
  console.log('✓ 第 1 题：' + doc.getElementById('questionText').textContent);
  console.log('  图示 ' + doc.querySelectorAll('#groups .group').length + ' 组，选项 ' +
    [].slice.call(doc.querySelectorAll('.option-num')).map(o => o.textContent).join(' / '));

  // 3. 先答错一次：给提示、留在本题、不得分
  const qText = doc.getElementById('questionText').textContent;
  const q = win.Preview.game.current();
  const wrongBtn = [].slice.call(doc.querySelectorAll('.option'))
    .filter(b => b.querySelector('.option-num').textContent !== String(q.answer))[0];
  wrongBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.ok(/再想想/.test(doc.getElementById('feedback').textContent), '应提示再想想');
  assert.strictEqual(doc.getElementById('questionText').textContent, qText, '仍是同一题');
  assert.strictEqual(win.Preview.game.score, 0, '答错不得分');
  console.log('✓ 答错一次给提示并留在本题：' + doc.getElementById('feedback').textContent.trim());

  // 4. 第二次答对：出讲解（加法展开 + 乘法式 + 口诀）
  const rightBtn = [].slice.call(doc.querySelectorAll('.option'))
    .filter(b => b.querySelector('.option-num').textContent === String(q.answer))[0];
  rightBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.ok(/答对了/.test(doc.getElementById('feedback').textContent), '答对反馈');
  const explain = doc.getElementById('explain');
  assert.strictEqual(explain.style.display, 'block', '讲解应显示');
  assert.ok(explain.textContent.indexOf('×') !== -1, '讲解含乘法式');
  console.log('✓ 答对后讲解：' + explain.textContent.trim().replace(/\s+/g, ' '));

  // 5. 本关剩余题全对，到成绩页
  let guard = 0;
  while (doc.getElementById('screen-play').classList.contains('active') && guard++ < 300) {
    const g = win.Preview.game;
    if (g.current() && !win.Preview.locked) {
      const btn = [].slice.call(doc.querySelectorAll('.option'))
        .filter(b => !b.disabled && b.querySelector('.option-num').textContent === String(g.current().answer))[0];
      if (btn) btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    }
    await sleep(250);
  }
  assert.ok(doc.getElementById('screen-result').classList.contains('active'), '应进入成绩页');
  assert.ok(Number(doc.getElementById('resultScore').textContent) > 0, '得分 > 0');
  console.log('✓ 成绩页：' + doc.getElementById('resultScore').textContent + ' 分 ' +
    doc.getElementById('resultStars').textContent + '，' +
    doc.getElementById('resultStats').textContent.trim().replace(/\s+/g, ' '));

  // 6. 回地图，进度已落盘
  doc.getElementById('btnHome').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.ok(doc.getElementById('screen-home').classList.contains('active'), '应回到地图');
  assert.ok(!/⭐ 0 \//.test(doc.getElementById('totalStars').textContent), '星数应已更新');
  console.log('✓ 回到地图，进度已保存：' + doc.getElementById('totalStars').textContent.trim());

  // 7. 第 2 关全对拿三星，再重玩全错，已有成绩不能掉
  await playLevel(1, true);
  const best = Number(doc.getElementById('resultScore').textContent);
  assert.ok(/新纪录/.test(doc.getElementById('resultBest').textContent), '首次通关应是新纪录');
  doc.getElementById('btnHome').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  console.log('✓ 第 2 关全对：' + best + ' 分三星');

  await playLevel(1, false);
  assert.strictEqual(Number(doc.getElementById('resultScore').textContent), 0, '全错应 0 分');
  assert.ok(/☆☆☆/.test(doc.getElementById('resultStars').textContent), '全错应 0 星');
  doc.getElementById('btnHome').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const card = doc.querySelectorAll('#levelList .level')[1];
  assert.ok(/★★★/.test(card.textContent), '重玩失手不应掉星');
  assert.ok(card.textContent.indexOf('最高 ' + best + ' 分') !== -1, '最高分应保留');
  console.log('✓ 重玩全错 0 分，但已有成绩不掉：' +
    card.querySelector('.level-stars').textContent + ' ' + card.querySelector('.level-best').textContent);

  assert.strictEqual(errors.length, 0, '页面 JS 报错：' + errors.join('; '));
  console.log('\n浏览器预览版冒烟测试通过');
  win.close();
  server.close();
}).on('error', e => {
  console.error('FAIL: ' + e.message);
  process.exit(1);
});
