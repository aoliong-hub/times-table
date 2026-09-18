const Questions = require('../../core/questions.js');
const Progress = require('../../core/progress.js');

Page({
  data: {
    levels: [],
    totalStars: 0,
    maxStars: Questions.levels.length * 3
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const levels = Questions.levels.map(lv => {
      const rec = Progress.of(lv.id);
      return {
        id: lv.id,
        name: lv.name,
        icon: lv.icon,
        color: lv.color,
        desc: lv.desc,
        count: lv.count,
        stars: rec.stars,
        best: rec.best,
        starText: '★'.repeat(rec.stars) + '☆'.repeat(3 - rec.stars)
      };
    });
    this.setData({ levels: levels, totalStars: Progress.totalStars() });
  },

  onTapLevel(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/play/play?level=' + id });
  },

  onShareAppMessage() {
    return {
      title: '生活里的乘法：钟表、钱币、星期，玩着学乘法口诀',
      path: '/pages/home/home'
    };
  }
});
