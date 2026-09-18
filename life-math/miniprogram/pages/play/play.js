const Questions = require('../../core/questions.js');
const Game = require('../../core/game.js');
const Progress = require('../../core/progress.js');

Page({
  data: {
    level: null,
    q: null,
    groupCells: [],   // 图示：每份一组，组内 per 个小图标
    options: [],      // [{ value, state: ''|'right'|'wrong' }]
    score: 0,
    combo: 0,
    done: 0,
    total: 0,
    locked: false,    // 判定动画期间锁住点击
    feedback: '',     // 反馈文字
    feedbackType: '', // right | wrong | retry
    showExplain: false,
    triesLeft: Game.MAX_TRIES
  },

  onLoad(options) {
    const levelId = options.level || Questions.levels[0].id;
    const level = Questions.getLevel(levelId);
    if (!level) {
      wx.showToast({ title: '关卡不存在', icon: 'none' });
      wx.navigateBack();
      return;
    }
    wx.setNavigationBarTitle({ title: level.name });
    this.game = Game.create(levelId);
    this.setData({
      level: { id: level.id, name: level.name, icon: level.icon, color: level.color },
      total: this.game.questions.length
    });
    this.renderQuestion();
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
  },

  renderQuestion() {
    const q = this.game.current();
    if (!q) return;
    this.setData({
      q: q,
      groupCells: this.buildCells(q),
      options: q.options.map(v => ({ value: v, state: '' })),
      score: this.game.score,
      combo: this.game.combo,
      done: this.game.progress().done,
      locked: false,
      feedback: '',
      feedbackType: '',
      showExplain: false,
      triesLeft: Game.MAX_TRIES - this.game.tries
    });
  },

  // 图示：cell 为空时不画图标，改用「每份是几」的数字卡
  buildCells(q) {
    const groups = [];
    for (let g = 0; g < q.groups; g++) {
      const cells = [];
      if (q.cell) {
        for (let i = 0; i < q.per; i++) cells.push(q.cell);
      }
      groups.push({ index: g + 1, cells: cells, label: q.per + '' });
    }
    return groups;
  },

  onTapOption(e) {
    if (this.data.locked) return;
    const value = Number(e.currentTarget.dataset.value);
    // 已经点错过的选项不再消耗机会
    const picked = this.data.options.filter(o => o.value === value)[0];
    if (picked && picked.state === 'wrong') return;
    const res = this.game.answer(value);

    // 标记被点的选项
    const options = this.data.options.map(o => {
      if (o.value !== value) return o;
      return { value: o.value, state: res.correct ? 'right' : 'wrong' };
    });

    if (res.correct) {
      wx.vibrateShort && wx.vibrateShort({ type: 'light' });
      this.setData({
        options: options,
        locked: true,
        score: this.game.score,
        combo: res.combo,
        showExplain: true,
        feedbackType: 'right',
        feedback: this.praise(res)
      });
      this.next(res, 1600);
      return;
    }

    if (res.retry) {
      // 还有一次机会：只锁住这个错选项，提示后可以继续点
      this.setData({
        options: options,
        feedbackType: 'retry',
        feedback: '再想想～ ' + this.data.q.tip,
        triesLeft: Game.MAX_TRIES - this.game.tries
      });
      return;
    }

    // 机会用完，公布答案
    const revealed = options.map(o => {
      if (o.value === res.answer) return { value: o.value, state: 'right' };
      return o;
    });
    this.setData({
      options: revealed,
      locked: true,
      combo: 0,
      showExplain: true,
      feedbackType: 'wrong',
      feedback: '答案是 ' + res.answer + ' ' + this.data.q.unit
    });
    this.next(res, 2400);
  },

  praise(res) {
    if (res.combo >= 5) return '太厉害了！连对 ' + res.combo + ' 题 +' + res.gain;
    if (res.combo >= 3) return '连对 ' + res.combo + ' 题！+' + res.gain;
    return '答对了！+' + res.gain;
  },

  next(res, delay) {
    this.timer = setTimeout(() => {
      if (res.finished) {
        const result = this.game.result();
        Progress.save(result.levelId, result);
        wx.redirectTo({
          url: '/pages/result/result?level=' + result.levelId +
            '&score=' + result.score +
            '&max=' + result.maxScore +
            '&stars=' + result.stars +
            '&right=' + result.rightCount +
            '&wrong=' + result.wrongCount +
            '&combo=' + result.bestCombo +
            '&total=' + result.total
        });
      } else {
        this.renderQuestion();
      }
    }, delay);
  },

  onTapQuit() {
    wx.navigateBack();
  }
});
