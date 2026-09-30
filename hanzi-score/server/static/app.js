/* 田字格小老师 —— 上传、打分、渲染结果（单卡片两状态） */
(function () {
  'use strict';

  var MAX_BYTES = 8 * 1024 * 1024;

  var el = {
    stepUpload: document.getElementById('step-upload'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    dropHint: document.getElementById('drop-hint'),
    previewWrap: document.getElementById('preview-wrap'),
    preview: document.getElementById('preview'),
    fileName: document.getElementById('file-name'),
    scoreBtn: document.getElementById('score-btn'),
    resetBtn: document.getElementById('reset-btn'),
    error: document.getElementById('error'),
    result: document.getElementById('result'),
    scoreRing: document.getElementById('score-ring'),
    scoreNum: document.getElementById('score-num'),
    levelBadge: document.getElementById('level-badge'),
    charLine: document.getElementById('char-line'),
    cellList: document.getElementById('cell-list'),
    dims: document.getElementById('dims'),
    improveWrap: document.getElementById('improve-wrap'),
    improvements: document.getElementById('improvements'),
    rewrite: document.getElementById('rewrite'),
    rewriteReason: document.getElementById('rewrite-reason'),
    rewriteAdvice: document.getElementById('rewrite-advice'),
    geometry: document.getElementById('geometry'),
    geometryOriginal: document.getElementById('geometry-original'),
    geometryGrid: document.getElementById('geometry-grid'),
    geometryInk: document.getElementById('geometry-ink'),
    geometryRows: document.getElementById('geometry-rows'),
    meta: document.getElementById('meta')
  };

  var currentFile = null;
  var busy = false;

  /* ---------- 小工具 ---------- */

  function show(node) { node.classList.remove('hidden'); }
  function hide(node) { node.classList.add('hidden'); }

  /* ---------- 对比图图层控制 ---------- */
  /* 全部/红/黄/绿是一组单选（一次只亮一个）；「只看标准」与这组互斥：
     进入时其它按钮变灰（仍可点击退出），点其它按钮则退出只看标准 */

  var LAYER_NAMES = ['green', 'yellow', 'red'];
  var currentFilter = 'all';
  var currentStd = false;

  function layerBtn(name) {
    return document.querySelector('#layer-btns [data-layer="' + name + '"]');
  }

  function setLayerImg(name, suffix, uri) {
    var img = document.getElementById('geometry-' + suffix + '-' + name);
    if (!img) return;
    if (uri) {
      img.src = uri;
      img.dataset.on = '1';
    } else {
      img.removeAttribute('src');
      delete img.dataset.on;
      img.style.display = 'none';
    }
  }

  function applyLayers() {
    LAYER_NAMES.forEach(function (n) {
      ['layer', 'cl'].forEach(function (suffix) {
        var img = document.getElementById('geometry-' + suffix + '-' + n);
        if (img) img.style.display =
          (!currentStd && (currentFilter === 'all' || currentFilter === n)
           && img.dataset.on === '1') ? '' : 'none';
      });
    });
    // 高亮：单选组里选中的那个；只看标准模式下其它按钮全部变灰
    ['all'].concat(LAYER_NAMES).forEach(function (name) {
      var btn = layerBtn(name);
      if (!btn) return;
      btn.classList.toggle('active', !currentStd && currentFilter === name);
      btn.classList.toggle('dim', currentStd);
    });
  }

  function setLayerFilter(name) {
    if (currentStd) setStandardOnly(false);   // 互斥：选颜色即退出只看标准
    currentFilter = name;
    applyLayers();
  }

  var btnBox = document.getElementById('layer-btns');
  if (btnBox) {
    btnBox.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (btn && !btn.disabled && btn.getAttribute('data-layer')) {
        setLayerFilter(btn.getAttribute('data-layer'));
      }
    });
  }

  var stdBtn = document.getElementById('btn-standard');
  var stdImg = document.getElementById('geometry-std');

  function setStandardOnly(on) {
    currentStd = on;
    if (stdBtn) stdBtn.classList.toggle('active', on);
    if (el.geometryInk) {
      el.geometryInk.style.display = on ? 'none' : '';
    }
    if (stdImg) {
      stdImg.style.display = (on && stdImg.dataset.on === '1') ? '' : 'none';
    }
    applyLayers();
  }

  if (stdBtn) {
    stdBtn.addEventListener('click', function () {
      setStandardOnly(!currentStd);
    });
  }

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
    show(el.stepUpload);
    hide(el.result);
    hide(el.resetBtn);
    el.scoreBtn.disabled = false;
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
    show(el.stepUpload);
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
    el.scoreBtn.textContent = on ? '老师正在看…' : '开始打分';
    el.scoreBtn.classList.toggle('waiting', on);
  }

  function submit() {
    clearError();
    setBusy(true);

    var form = new FormData();
    form.append('file', currentFile);

    fetch('api/score', { method: 'POST', body: form })
      .then(function (resp) {
        var ctype = resp.headers.get('content-type') || '';
        if (!resp.ok) {
          return resp.json().catch(function () { return {}; }).then(function (d) {
            showError(d && d.detail ? d.detail : '打分失败，稍后再试。');
          });
        }
        // 多格照片是 NDJSON 流：打完一格推一格，逐格点亮
        if (ctype.indexOf('ndjson') >= 0) return streamResults(resp);
        return resp.json().then(render);
      })
      .catch(function (err) {
        console.log('[dbgCatch]', err && err.message);
        showError('连不上打分服务，检查一下服务是否还在运行。');
      })
      .then(function () {
        setBusy(false);
      });
  }

  /* 读 NDJSON 流：meta → cell… → done，每行一个 JSON */
  function streamResults(resp) {
    var reader = resp.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var firstShown = false;

    function handle(d) {
      if (d.type === 'single') { render(d); return; }   // 单格兼容
      console.log('[dbg] 行类型', d.type);
      if (d.type === 'meta') {
        el.cellList.textContent = '';
        var hint = document.createElement('div');
        hint.className = 'cell-progress';
        hint.textContent = '整页 ' + d.total_cells + ' 格，' +
          d.count + ' 格写了字，正在逐格批改…';
        el.cellList.appendChild(hint);
        show(el.cellList);
        return;
      }
      if (d.type === 'cell') {
        var progress = el.cellList.querySelector('.cell-progress');
        if (progress) progress.remove();
        addCellRow(d);
        if (!firstShown) {
          firstShown = true;
          el.cellList.children[0].classList.add('active');
          renderDetail(d);
        }
      }
    }

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          if (buf.trim()) { try { handle(JSON.parse(buf)); } catch (e) { /* 忽略坏行 */ } }
          return;
        }
        buf += dec.decode(chunk.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(function (line) {
          if (!line.trim()) return;
          try { handle(JSON.parse(line)); } catch (e) { /* 忽略坏行 */ }
        });
        return pump();
      });
    }
    return pump();
  }

  /* ---------- 渲染结果 ---------- */

  function render(data) {
    if (data.results && data.results.length) {      // 兼容旧整包结构
      el.cellList.textContent = '';
      data.results.forEach(function (r) { addCellRow(r); });
      show(el.cellList);
      el.cellList.children[0].classList.add('active');
      renderDetail(data.results[0]);
      return;
    }
    hide(el.cellList);
    renderDetail(data);
  }

  /* 多格照片：顶部一格一个按钮，点谁下面显示谁的详情 */
  function addCellRow(r) {
    var idx = el.cellList.querySelectorAll('.cell-row').length;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cell-row' + (r.error ? ' bad' : '');
    var text = '第 ' + (r.cell || idx + 1) + ' 格';
    if (r.error) {
      text += '　' + r.error;
    } else {
      text += '　' + r.total + ' 分　' + (r.emoji || '') + (r.badge || r.level || '');
      if (r.need_rewrite) text += '　✏️';
    }
    btn.textContent = text;
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(el.cellList.children, function (c) {
        c.classList.remove('active');
      });
      btn.classList.add('active');
      renderDetail(r);
    });
    el.cellList.appendChild(btn);
  }

  function renderDetail(data) {
    el.scoreNum.textContent = data.total;
    // 分数圈颜色：>=80 绿，>=60 黄，其余红
    el.scoreRing.classList.toggle('mid', data.total >= 60 && data.total < 80);
    el.scoreRing.classList.toggle('bad', data.total < 60);
    el.levelBadge.textContent = (data.emoji ? data.emoji + ' ' : '') +
      (data.badge || data.level || '');

    var charText = '';
    if (data.char) charText = '认出来的字：' + data.char;
    if (data.target_char) {
      charText += (charText ? '　' : '') + '要写的字：' + data.target_char;
      if (data.char_match === false) charText += '（写的不是这个字）';
    }
    el.charLine.textContent = charText;

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

    // 本地几何比对：左 = 上传照片，右 = 多层叠加的米字格对比（可按色筛选）
    el.geometryRows.textContent = '';
    var geo = data.geometry;
    var ov = data.geometry_overlay;
    if (geo && geo.ok && (geo.lines || []).length) {
      geo.lines.forEach(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        el.geometryRows.appendChild(li);
      });
      if (ov) {
        // 底图 = 米字格；ink = 黑色手写；std = 深灰标准字形（只看标准用）
        el.geometryOriginal.src = el.preview.src || '';
        el.geometryGrid.src = ov.grid || '';
        el.geometryInk.src = ov.ink || '';
        if (ov.std) {
          stdImg.src = ov.std;
          stdImg.dataset.on = '1';
        } else {
          stdImg.removeAttribute('src');
          delete stdImg.dataset.on;
        }
        LAYER_NAMES.forEach(function (name) {
          setLayerImg(name, 'layer', ov[name]);
          setLayerImg(name, 'cl', ov[name + '_cl']);
          // 没有该档笔画 → 按钮置灰不可点
          var btn = layerBtn(name);
          if (btn) btn.disabled = !ov[name];
        });
        // 每次重打分复位：全部档位显示、退出只看标准
        currentFilter = 'all';
        setStandardOnly(false);
        show(el.geometry);
      }
    } else {
      hide(el.geometry);
    }

    var bits = [];
    if (typeof data.elapsed === 'number') bits.push('用时 ' + data.elapsed.toFixed(1) + ' 秒');
    el.meta.textContent = bits.join('　·　');

    // 切到结果态
    hide(el.stepUpload);
    show(el.result);
    show(el.resetBtn);
    el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 启动：健康检查（失败不打扰用户，打分时自会报错） ---------- */

  fetch('api/health').catch(function () {});
})();
