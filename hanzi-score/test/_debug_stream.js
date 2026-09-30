const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'server', 'static', 'index.html'), 'utf-8');
const HTML_MAIN = HTML.replace('<script src="static/app.js"></script>',
  '<script>' + fs.readFileSync(path.join(__dirname, '..', 'server', 'static', 'app.js'), 'utf-8') + '</script>');

function ndjsonResponse(lines) {
  const text = lines.map(d => JSON.stringify(d)).join('\n') + '\n';
  const enc = new TextEncoder();
  let sent = false;
  return {
    ok: true, status: 200,
    headers: { get: () => 'application/x-ndjson' },
    body: { getReader: () => ({ read: () => {
      if (sent) return Promise.resolve({ done: true });
      sent = true;
      return Promise.resolve({ done: false, value: enc.encode(text) });
    }})}
  };
}

(async () => {
  const dom = new JSDOM(HTML_MAIN, { url: 'http://localhost:8360/', runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window;
  win.URL.createObjectURL = () => 'blob:fake';
  win.URL.revokeObjectURL = () => {};
  win.Element.prototype.scrollIntoView = function () {};
  const nd = [
    { type: 'meta', count: 1, empty_cells: 0, total_cells: 1 },
    { type: 'cell', cell: 1, char: '双', total: 78, level: '良好', badge: '', emoji: '',
      need_rewrite: false, dimensions: [], praise: '', improvements: [],
      geometry: null, geometry_overlay: null },
    { type: 'done', elapsed: 1 }
  ];
  win.fetch = (url) => {
    if (/api\/health$/.test(String(url))) return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ status: 'ok' }) });
    if (/api\/score$/.test(String(url))) return ndjsonResponse(nd);
    return Promise.reject(new Error('unexpected ' + url));
  };
  // 选文件
  const dt = new win.DataTransfer();
  dt.items.add(new win.File(['x'], 'a.png', { type: 'image/png' }));
  const input = win.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  win.document.getElementById('score-btn').click();
  await new Promise(r => setTimeout(r, 200));
  const err = win.document.getElementById('error');
  process.stdout.write('error显示: ' + (err && !err.classList.contains('hidden') ? err.textContent : '(无)') + '\n');
  process.stdout.write('cellList: ' + win.document.getElementById('cell-list').innerHTML.slice(0, 200) + '\n');
  process.stdout.write('score: ' + win.document.getElementById('score-num').textContent + '\n');
})();
