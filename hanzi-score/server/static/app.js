/* 田字格小老师 —— 上传、打分、渲染结果 */
(function () {
  'use strict';

  var MAX_BYTES = 8 * 1024 * 1024;

  var el = {
    targetChar: document.getElementById('target-char'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    dropHint: document.getElementById('drop-hint'),
    previewWrap: document.getElementById('preview-wrap'),
    preview: document.getElementById('preview'),
    fileName: document.getElementById('file-name'),
    scoreBtn: document.getElementById('score-btn'),
    resetBtn: document.getElementById('reset-btn'),
    error: document.getElementById('error'),
    mockBadge: document.getElementById('mock-badge'),
    result: document.getElementById('result'),
    scoreNum: document.getElementById('score-num'),
    levelBadge: document.getElementById('level-badge'),
    charLine: document.getElementById('char-line'),
    praise: document.getElementById('praise'),
    dims: document.getElementById('dims'),
    improveWrap: document.getElementById('improve-wrap'),
    improvements: document.getElementById('improvements'),
    rewrite: document.getElementById('rewrite'),
    rewriteReason: document.getElementById('rewrite-reason'),
    rewriteAdvice: document.getElementById('rewrite-advice'),
    meta: document.getElementById('meta')
  };

  var currentFile = null;
  var busy = false;

  /* ---------- 小工具 ---------- */

  function show(node) { node.classList.remove('hidden'); }
  function hide(node) { node.classList.add('hidden'); }

  function showError(msg) {
    el.error.textContent = msg;
    show(el.error);
  }

  function clearError() {
    el.error.textContent = '';
    hide(el.error);
  }

  /* ---------- 选图 ---------- */

  function pickFile(file) {
    clearError();
    if (!file) return;

    if (file.type && file.type.indexOf('image/') !== 0) {
      showError('这不像是图片，选一张照片试试。');
      return;
    }
    if (file.size > MAX_BYTES) {
      showError('图片太大了（超过 8MB），换一张小一点的。');
      return;
    }

    currentFile = file;
    el.preview.src = URL.createObjectURL(file);
    el.fileName.textContent = file.name || '已选好照片';
    hide(el.dropHint);
    show(el.previewWrap);
    show(el.resetBtn);
    el.scoreBtn.disabled = false;
    hide(el.result);
  }

  function resetAll() {
    currentFile = null;
    el.fileInput.value = '';
    if (el.preview.src) URL.revokeObjectURL(el.preview.src);
    el.preview.removeAttribute('src');
    show(el.dropHint);
    hide(el.previewWrap);
    hide(el.resetBtn);
    hide(el.result);
    clearError();
    el.scoreBtn.disabled = true;
  }

  el.dropZone.addEventListener('click', function (e) {
    if (busy) return;
    if (e.target === el.fileInput) return;
    el.fileInput.click();
  });

  el.dropZone.addEventListener('keydown', function (e) {
    if (busy) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.fileInput.click();
    }
  });

  el.fileInput.addEventListener('change', function () {
    pickFile(el.fileInput.files && el.fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    el.dropZone.addEventListener(type, function (e) {
      e.preventDefault();
      if (!busy) el.dropZone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach(function (type) {
    el.dropZone.addEventListener(type, function (e) {
      e.preventDefault();
      el.dropZone.classList.remove('dragging');
    });
  });

  el.dropZone.addEventListener('drop', function (e) {
    if (busy) return;
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) pickFile(dt.files[0]);
  });

  el.resetBtn.addEventListener('click', function () {
    if (busy) return;
    resetAll();
  });

  /* ---------- 打分 ---------- */

  el.scoreBtn.addEventListener('click', function () {
    if (busy || !currentFile) return;
    submit();
  });

  function setBusy(on) {
    busy = on;
    el.scoreBtn.disabled = on || !currentFile;
    el.resetBtn.disabled = on;
    el.scoreBtn.textContent = on ? '老师正在看…' : '开始打分';
    el.scoreBtn.classList.toggle('waiting', on);
  }

  function submit() {
    clearError();
    setBusy(true);

    var form = new FormData();
    form.append('file', currentFile);
    var target = (el.targetChar.value || '').trim();
    if (target) form.append('target_char', target);

    fetch('/api/score', { method: 'POST', body: form })
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { ok: resp.ok, data: data };
        }).catch(function () {
          return { ok: false, data: { detail: '服务器返回的内容看不懂（HTTP ' + resp.status + '）' } };
        });
      })
      .then(function (res) {
        if (!res.ok) {
          showError(res.data && res.data.detail ? res.data.detail : '打分失败，稍后再试。');
          return;
        }
        render(res.data);
      })
      .catch(function () {
        showError('连不上打分服务，检查一下服务是否还在运行。');
      })
      .then(function () {
        setBusy(false);
      });
  }

  /* ---------- 渲染结果 ---------- */

  function render(data) {
    el.scoreNum.textContent = data.total;
    el.levelBadge.textContent = (data.emoji ? data.emoji + ' ' : '') +
      (data.badge || data.level || '');

    var charText = '';
    if (data.char) charText = '认出来的字：' + data.char;
    if (data.target_char) {
      charText += (charText ? '　' : '') + '要写的字：' + data.target_char;
      if (data.char_match === false) charText += '（写的不是这个字）';
    }
    el.charLine.textContent = charText;

    el.praise.textContent = data.praise || '';

    // 维度进度条
    el.dims.textContent = '';
    (data.dimensions || []).forEach(function (d) {
      var pct = d.full ? Math.round((d.score / d.full) * 100) : 0;

      var row = document.createElement('div');
      row.className = 'dim';

      var head = document.createElement('div');
      head.className = 'dim-head';
      var name = document.createElement('span');
      name.className = 'dim-name';
      name.textContent = d.name;
      var val = document.createElement('span');
      val.className = 'dim-score';
      val.textContent = d.score + ' / ' + d.full;
      head.appendChild(name);
      head.appendChild(val);

      var bar = document.createElement('div');
      bar.className = 'dim-bar';
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', d.name + ' ' + d.score + ' 分，满分 ' + d.full + ' 分');
      var fill = document.createElement('span');
      fill.className = 'dim-fill' + (pct < 60 ? ' low' : '');
      fill.style.width = pct + '%';
      bar.appendChild(fill);

      row.appendChild(head);
      row.appendChild(bar);

      if (d.comment) {
        var cmt = document.createElement('p');
        cmt.className = 'dim-comment';
        cmt.textContent = d.comment;
        row.appendChild(cmt);
      }

      el.dims.appendChild(row);
    });

    // 改进点
    el.improvements.textContent = '';
    var items = data.improvements || [];
    if (items.length) {
      items.forEach(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        el.improvements.appendChild(li);
      });
      show(el.improveWrap);
    } else {
      hide(el.improveWrap);
    }

    // 重写提示
    el.result.classList.toggle('need-rewrite', !!data.need_rewrite);
    if (data.need_rewrite) {
      el.rewriteReason.textContent = data.rewrite_reason || '';
      el.rewriteAdvice.textContent = data.rewrite_advice || '擦掉再写一遍，慢一点写会更好。';
      show(el.rewrite);
    } else {
      hide(el.rewrite);
    }

    var bits = [];
    if (data.model) bits.push('模型 ' + data.model);
    if (typeof data.elapsed === 'number') bits.push('用时 ' + data.elapsed.toFixed(1) + ' 秒');
    if (data.mock) bits.push('演示数据');
    el.meta.textContent = bits.join('　·　');

    show(el.result);
    el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 启动：查一下服务是不是 mock 模式 ---------- */

  fetch('/api/health')
    .then(function (r) { return r.json(); })
    .then(function (h) {
      if (h && h.mock) show(el.mockBadge);
      else if (h && !h.has_api_key) {
        el.mockBadge.textContent = '服务器没有配 API key，打分会失败。配好 LLM_API_KEY 后重启服务。';
        show(el.mockBadge);
      }
    })
    .catch(function () { /* 健康检查失败不打扰用户，打分时自会报错 */ });

  /* 星空背景 */
  (function stars() {
    var box = document.querySelector('.stars');
    if (!box) return;
    for (var i = 0; i < 60; i++) {
      var s = document.createElement('span');
      s.className = 'star';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
      box.appendChild(s);
    }
  })();
})();
