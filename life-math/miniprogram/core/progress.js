// progress.js - 关卡进度存储。注入 storage 适配器，小程序传 wx，H5 传 localStorage 包装
const KEY = 'lifeMath_progress';

let store = {
  get(key) { return null; },
  set(key, val) {}
};

const Progress = {
  // adapter: { get(key), set(key, value) }
  use(adapter) {
    if (adapter) store = adapter;
  },

  all() {
    const data = store.get(KEY);
    return (data && typeof data === 'object') ? data : {};
  },

  // 单关记录：{ stars, best }
  of(levelId) {
    const rec = this.all()[levelId];
    return {
      stars: (rec && rec.stars) || 0,
      best: (rec && rec.best) || 0
    };
  },

  // 只在成绩变好时覆盖，孩子重玩失手不会掉星
  save(levelId, result) {
    const data = this.all();
    const old = this.of(levelId);
    data[levelId] = {
      stars: Math.max(old.stars, result.stars || 0),
      best: Math.max(old.best, result.score || 0)
    };
    store.set(KEY, data);
    return data[levelId];
  },

  totalStars() {
    const data = this.all();
    return Object.keys(data).reduce((sum, k) => sum + ((data[k] && data[k].stars) || 0), 0);
  },

  reset() {
    store.set(KEY, {});
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = Progress;
else if (typeof window !== 'undefined') window.Progress = Progress;
