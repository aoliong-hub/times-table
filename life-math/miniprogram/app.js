// app.js - 小程序入口
const Progress = require('./core/progress.js');

App({
  globalData: {},

  onLaunch() {
    // 把小程序同步存储接给 Progress
    Progress.use({
      get(key) {
        try { return wx.getStorageSync(key) || null; } catch (e) { return null; }
      },
      set(key, value) {
        try { wx.setStorageSync(key, value); } catch (e) {}
      }
    });
  }
});
