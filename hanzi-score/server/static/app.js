/* 田字格小老师 —— 上传 → 拉正分割预览 → 点格子批改（两步交互） */
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
    pageWrap: document.getElementById('page-wrap'),
    correctedImage: document.getElementById('corrected-image'),
    cellLayer: document.getElementById('cell-layer'),
    pageHint: document.getElementById('page-hint'),
    detail: document.getElementById('detail'),
    scoreRing: document.getElementById('score-ring'),
    scoreNum: document.getElementById('score-num'),
    levelBadge: document.getElementById('level-badge'),
    charLine: document.getElementById('char-line'),
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
  /* 当前页的会话状态：服务端 id、每格四边形、已批改的结果 */
  var page = { id: null, quads: [], width: 0, height: 0, results: {} };

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
    page = { id: null, quads: [], width: 0, height: 0, results: {} };
    el.fileInput.value = '';
    if (el.preview.src) URL.revokeObjectURL(el.preview.src);
    el.preview.removeAttribute('src');
    el.correctedImage.removeAttribute('src');
    el.cellLayer.textContent = '';
    show(el.dropHint);
    hide(el.previewWrap);
    hide(el.resetBtn);
    hide(el.result);
    hide(el.detail);
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

  /* ---------- 第一步：拉正 + 分割预览（不做 OCR 和打分） ---------- */

  el.scoreBtn.addEventListener('click', function () {
    if (busy || !currentFile) return;
    submit();
  });

  function setBusy(on) {
    busy = on;
    el.scoreBtn.disabled = on || !currentFile;
    el.scoreBtn.textContent = on ? '正在找格子…' : '识别格子';
    el.scoreBtn.classList.toggle('waiting', on);
  }

  function submit() {
    clearError();
    setBusy(true);

    var form = new FormData();
    form.append('file', currentFile);

    fetch('api/prepare', { method: 'POST', body: form })
      .then(function (resp) {
        if (!resp.ok) {
          return resp.json().catch(function () { return {}; }).then(function (d) {
            showError(d && d.detail ? d.detail : '没找到田字格，把格子拍正、拍满整张图再试一次。');
          });
        }
        return resp.json().then(renderPrepare);
      })
      .catch(function () {
        showError('连不上打分服务，检查一下服务是否还在运行。');
      })
      .then(function () {
        setBusy(false);
      });
  }

  function renderPrepare(data) {
    page = { id: data.id, quads: data.quads || [], width: data.width,
             height: data.height, results: {} };

    el.correctedImage.src = data.corrected;
    el.cellLayer.textContent = '';
    (data.quads || []).forEach(function (quad, i) {
      var div = document.createElement('div');
      div.className = 'cell-hot';
      div.id = 'cell-' + (i + 1);
      div.setAttribute('role', 'button');
      div.setAttribute('aria-label', '第 ' + (i + 1) + ' 格');
      var box = quadBBox(quad, data.width, data.height);
      div.style.left = box.x + '%';
      div.style.top = box.y + '%';
      div.style.width = box.w + '%';
      div.style.height = box.h + '%';
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1);
      div.appendChild(num);
      div.addEventListener('click', function () { scoreCell(i + 1); });
      el.cellLayer.appendChild(div);
    });

    show(el.result);
    hide(el.stepUpload);
    show(el.resetBtn);
    hide(el.detail);
    setPageHint('共 ' + data.count + ' 格，点一个格子开始批改');
    el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // 单格照片：不用再点，直接批改
    if (data.count === 1) scoreCell(1);
  }

  function quadBBox(quad, width, height) {
    var xs = quad.map(function (p) { return p[0]; });
    var ys = quad.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs);
    var x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys);
    var y1 = Math.max.apply(null, ys);
    var w = width || 1;
    var h = height || 1;
    return {
      x: (x0 / w) * 100,
      y: (y0 / h) * 100,
      w: ((x1 - x0) / w) * 100,
      h: ((y1 - y0) / h) * 100
    };
  }

  function setPageHint(text) {
    el.pageHint.textContent = text;
  }

  function cellDiv(n) {
    return document.getElementById('cell-' + n);
  }

  /* ---------- 第二步：点中的格子才做 OCR + 打分 ---------- */

  function scoreCell(n) {
    var res = page.results[n];
    if (res) {                     // 批改过：直接看详情
      setActiveCell(n);
      renderDetail(res);
      return;
    }
    var div = document.getElementById('cell-' + n);
    if (!div || busyCell[n]) return;
    busyCell[n] = true;
    div.classList.add('loading');
    setPageHint('第 ' + n + ' 格批改中…');

    var form = new FormData();
    form.append('page_id', page.id);
    form.append('cell', String(n));

    fetch('api/score_cell', { method: 'POST', body: form })
      .then(function (resp) {
        return resp.json().then(function (d) {
          return { ok: resp.ok, data: d };
        });
      })
      .then(function (r) {
        delete busyCell[n];
        div.classList.remove('loading');
        if (r.ok) {
          page.results[n] = r.data;
          updateCellDiv(n);
          setActiveCell(n);
          renderDetail(r.data);
          var done = Object.keys(page.results).length;
          setPageHint('已批改 ' + done + ' / ' + page.quads.length + ' 格，继续点格子看结果');
        } else {
          div.classList.add('err');
          var num = div.querySelector('.num');
          if (num) num.textContent = '✗';
          setPageHint('第 ' + n + ' 格：' + (r.data && r.data.detail
            ? r.data.detail : '没批改出来'));
        }
      })
      .catch(function () {
        delete busyCell[n];
        div.classList.remove('loading');
        setPageHint('连不上打分服务，检查一下服务是否还在运行。');
      });
  }
  var busyCell = {};

  function updateCellDiv(n) {
    var div = document.getElementById('cell-' + n);
    var res = page.results[n];
    if (!div || !res) return;
    div.classList.remove('loading');
    div.classList.add(res.total >= 80 ? 'good' : (res.total >= 60 ? 'mid' : 'bad'));
    var num = div.querySelector('.num');
    if (num) num.textContent = n + '·' + res.total;
  }

  function setActiveCell(n) {
    var prev = el.cellLayer.querySelector('.cell-hot.active');
    if (prev) prev.classList.remove('active');
    var div = document.getElementById('cell-' + n);
    if (div) div.classList.add('active');
  }

  /* ---------- 渲染单格详情 ---------- */

  function renderDetail(data) {
    el.scoreNum.textContent = data.total;
    // 分数圈颜色：>=80 绿，>=60 黄，其余红
    el.scoreRing.classList.toggle('mid', data.total >= 60 && data.total < 80);
    el.scoreRing.classList.toggle('bad', data.total < 60);
    el.levelBadge.textContent = (data.emoji ? data.emoji + ' ' : '') +
      (data.badge || data.level || '');

    var charText = '';
    if (data.cell) charText = '第 ' + data.cell + ' 格　';
    if (data.char) charText += '认出来的字：' + data.char;
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

    // 本地几何比对：左 = 这一格的手写，右 = 多层叠加的米字格对比（可按色筛选）
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
        el.geometryOriginal.src = data.cell_image || el.preview.src || '';
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
        // 每次切格复位：全部档位显示、退出只看标准
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

    // 切到详情态
    hide(el.stepUpload);
    show(el.result);
    show(el.resetBtn);
    show(el.detail);
    el.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 启动：健康检查（失败不打扰用户，打分时自会报错） ---------- */

  fetch('api/health').catch(function () {});
})();
