// preview.js - 浏览器预览版：复用 miniprogram/core 的同一套题库与计分引擎
Progress.use({
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
});

const WORDS = [
  '再试一次，你会更棒',
  '不错，已经会一部分啦',
  '很棒！生活里的乘法你懂了',
  '满星！你是乘法小超人'
];

const Preview = {
  game: null,
  level: null,
  timer: null,

  init() {
    this.renderHome();
    document.getElementById('btnQuit').addEventListener('click', () => this.show('home'));
    document.getElementById('btnHome').addEventListener('click', () => this.show('home'));
    document.getElementById('btnReplay').addEventListener('click', () => this.start(this.level.id));
  },

  show(name) {
    if (this.timer) clearTimeout(this.timer);
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
    if (name === 'home') this.renderHome();
    window.scrollTo(0, 0);
  },

  renderHome() {
    const list = document.getElementById('levelList');
    list.innerHTML = '';
    Questions.levels.forEach(lv => {
      const rec = Progress.of(lv.id);
      const item = document.createElement('div');
      item.className = 'level card';
      item.innerHTML = `
        <div class="level-icon" style="background:${lv.color}22;border-color:${lv.color}">${lv.icon}</div>
        <div class="level-info">
          <div class="level-name">${lv.name}</div>
          <div class="level-desc">${lv.desc}</div>
          <div class="level-meta">
            <span class="level-stars">${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}</span>
            <span class="level-best">${rec.best > 0 ? '最高 ' + rec.best + ' 分' : lv.count + ' 道题'}</span>
          </div>
        </div>
        <div class="level-go" style="color:${lv.color}">开始</div>
      `;
      item.addEventListener('click', () => this.start(lv.id));
      list.appendChild(item);
    });
    const total = Progress.totalStars();
    document.getElementById('totalStars').textContent = `⭐ ${total} / ${Questions.levels.length * 3}`;
  },

  start(levelId) {
    this.level = Questions.getLevel(levelId);
    this.game = Game.create(levelId);
    this.show('play');
    this.renderQuestion();
  },

  renderQuestion() {
    const q = this.game.current();
    if (!q) return;
    const g = this.game;

    document.getElementById('hudScore').textContent = '⭐ ' + g.score;
    document.getElementById('hudCombo').textContent = g.combo >= 2 ? '🔥 连对 ' + g.combo : '';
    document.getElementById('hudProgress').textContent = `第 ${g.progress().done + 1} / ${g.progress().total} 题`;
    document.getElementById('barFill').style.width = (g.progress().done * 100 / g.progress().total) + '%';
    document.getElementById('barFill').style.background = this.level.color;
    document.getElementById('questionIcon').textContent = this.level.icon;
    document.getElementById('questionText').textContent = q.text;

    // 图示
    const groups = document.getElementById('groups');
    groups.innerHTML = '';
    for (let i = 0; i < q.groups; i++) {
      const box = document.createElement('div');
      box.className = 'group';
      box.style.borderColor = this.level.color + '66';
      if (q.cell) {
        box.innerHTML = `<div class="group-cells">${('<span class="cell">' + q.cell + '</span>').repeat(q.per)}</div>`;
      } else {
        box.innerHTML = `<div class="group-num" style="color:${this.level.color}">${q.per}</div>`;
      }
      groups.appendChild(box);
    }
    document.getElementById('groupsLabel').textContent = `${q.groupLabel}，每份 ${q.per}`;

    // 选项
    const opts = document.getElementById('options');
    opts.innerHTML = '';
    q.options.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.innerHTML = `<span class="option-num">${v}</span><span class="option-unit">${q.unit}</span>`;
      btn.addEventListener('click', () => this.onAnswer(v, btn));
      opts.appendChild(btn);
    });

    document.getElementById('feedback').textContent = '';
    document.getElementById('feedback').className = 'feedback';
    document.getElementById('explain').style.display = 'none';
    this.locked = false;
  },

  onAnswer(value, btn) {
    if (this.locked) return;
    const q = this.game.current();
    const res = this.game.answer(value);
    const feedback = document.getElementById('feedback');

    if (res.retry) {
      btn.classList.add('wrong');
      btn.disabled = true;
      feedback.textContent = '再想想～ ' + q.tip;
      feedback.className = 'feedback retry';
      return;
    }

    this.locked = true;
    document.querySelectorAll('.option').forEach(b => { b.disabled = true; });

    if (res.correct) {
      btn.classList.add('right');
      feedback.textContent = res.combo >= 3
        ? `连对 ${res.combo} 题！+${res.gain}`
        : `答对了！+${res.gain}`;
      feedback.className = 'feedback right';
    } else {
      btn.classList.add('wrong');
      document.querySelectorAll('.option').forEach(b => {
        if (b.querySelector('.option-num').textContent === String(res.answer)) b.classList.add('right');
      });
      feedback.textContent = `答案是 ${res.answer} ${q.unit}`;
      feedback.className = 'feedback wrong';
    }

    document.getElementById('hudScore').textContent = '⭐ ' + this.game.score;
    document.getElementById('hudCombo').textContent = res.combo >= 2 ? '🔥 连对 ' + res.combo : '';

    const explain = document.getElementById('explain');
    explain.style.display = 'block';
    explain.innerHTML = `
      ${q.addition ? `<div class="explain-add">${q.addition}</div>` : ''}
      <div class="explain-formula">${q.formula}</div>
      ${q.chant ? `<div class="explain-chant">口诀：${q.chant}</div>` : ''}
    `;

    this.timer = setTimeout(() => {
      if (res.finished) this.renderResult();
      else this.renderQuestion();
    }, res.correct ? 1600 : 2400);
  },

  renderResult() {
    const r = this.game.result();
    const prevBest = Progress.of(r.levelId).best;
    Progress.save(r.levelId, r);

    document.getElementById('resultBadge').textContent = this.level.icon;
    document.getElementById('resultBadge').style.borderColor = this.level.color;
    document.getElementById('resultStars').textContent = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
    document.getElementById('resultWord').textContent = WORDS[r.stars];
    document.getElementById('resultScore').textContent = r.score;
    document.getElementById('resultMax').textContent = '满分 ' + r.maxScore;
    document.getElementById('resultBest').textContent = r.score > prevBest
      ? '🎉 新纪录！'
      : '最高 ' + prevBest + ' 分';
    document.getElementById('resultStats').innerHTML = `
      <div class="stat"><div class="stat-num" style="color:var(--energy-green)">${r.rightCount}</div><div class="stat-label">一次答对</div></div>
      <div class="stat"><div class="stat-num" style="color:var(--warn-red)">${r.wrongCount}</div><div class="stat-label">没答对</div></div>
      <div class="stat"><div class="stat-num" style="color:#ff9f43">${r.bestCombo}</div><div class="stat-label">最长连对</div></div>
    `;
    this.show('result');
  }
};

Preview.init();
window.Preview = Preview; // 方便在控制台调试，也供冒烟测试驱动
