const Questions = require('../../core/questions.js');
const Progress = require('../../core/progress.js');

const WORDS = [
  '再试一次，你会更棒',
  '不错，已经会一部分啦',
  '很棒！生活里的乘法你懂了',
  '满星！你是乘法小超人'
];

Page({
  data: {
    level: null,
    score: 0,
    max: 0,
    stars: 0,
    starText: '',
    right: 0,
    wrong: 0,
    combo: 0,
    total: 0,
    word: '',
    best: 0,
    isNewBest: false
  },

  onLoad(options) {
    const level = Questions.getLevel(options.level) || Questions.levels[0];
    const score = Number(options.score) || 0;
    const stars = Number(options.stars) || 0;
    const rec = Progress.of(level.id);

    wx.setNavigationBarTitle({ title: level.name + ' · 成绩' });
    this.setData({
      level: { id: level.id, name: level.name, icon: level.icon, color: level.color },
      score: score,
      max: Number(options.max) || 0,
      stars: stars,
      starText: '★'.repeat(stars) + '☆'.repeat(3 - stars),
      right: Number(options.right) || 0,
      wrong: Number(options.wrong) || 0,
      combo: Number(options.combo) || 0,
      total: Number(options.total) || 0,
      word: WORDS[stars],
      best: rec.best,
      isNewBest: score > 0 && score >= rec.best
    });
  },

  onTapReplay() {
    wx.redirectTo({ url: '/pages/play/play?level=' + this.data.level.id });
  },

  onTapHome() {
    // play 页是 redirectTo 到本页的，所以栈里是 home → result，退一层即可
    wx.navigateBack({
      fail() { wx.reLaunch({ url: '/pages/home/home' }); }
    });
  },

  onShareAppMessage() {
    return {
      title: '我在「' + this.data.level.name + '」拿了 ' + this.data.score + ' 分，你来试试？',
      path: '/pages/home/home'
    };
  }
});
