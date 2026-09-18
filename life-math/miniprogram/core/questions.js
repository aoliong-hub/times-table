// questions.js - 生活场景乘法题库（纯逻辑，不依赖 DOM / wx API）
// 同时供：微信小程序 require、H5 页面 <script>、Node 测试 require。

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

// 1~99 转中文，用于生成乘法口诀
function num2cn(n) {
  if (n <= 10) return CN[n];
  if (n < 20) return '十' + CN[n - 10];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return CN[ten] + '十' + (one ? CN[one] : '');
}

// 乘法口诀：小数在前。积小于 10 用「得」，积等于 10 读「一十」
// chantOf(3, 5) -> '三五十五'   chantOf(2, 3) -> '二三得六'   chantOf(2, 5) -> '二五一十'
function chantOf(a, b) {
  if (a < 1 || b < 1 || a > 9 || b > 9) return '';
  const small = Math.min(a, b);
  const big = Math.max(a, b);
  const p = small * big;
  if (p < 10) return CN[small] + CN[big] + '得' + CN[p];
  if (p === 10) return CN[small] + CN[big] + '一十';
  return CN[small] + CN[big] + num2cn(p);
}

// 关卡与题目模板。
// 每个模板：per 一份的数量，n 是份数，答案 = per * n。
// cell 为空表示一份数量太大，画不出小图标，改用「数字卡片」呈现。
const LEVELS = [
  {
    id: 'clock',
    name: '钟表岛',
    icon: '⏰',
    color: '#48dbfb',
    desc: '一大格 5 分钟，一小时 60 分钟',
    count: 8,
    templates: [
      {
        key: 'clock-grid', per: 5, minN: 2, maxN: 9, unit: '分钟', cell: '🔸',
        tip: '钟面 1 大格 = 5 分钟',
        text: n => `钟面上分针走 1 大格是 5 分钟，走了 ${n} 大格，一共多少分钟？`,
        groupLabel: n => `${n} 大格`
      },
      {
        key: 'clock-ten', per: 10, minN: 2, maxN: 6, unit: '分钟', cell: '📖',
        tip: '每天读书 10 分钟',
        text: n => `小明每天读书 10 分钟，${n} 天一共读了多少分钟？`,
        groupLabel: n => `${n} 天`
      },
      {
        key: 'clock-quarter', per: 15, minN: 2, maxN: 4, unit: '分钟', cell: '',
        tip: '一刻钟 = 15 分钟',
        text: n => `${n} 个一刻钟是多少分钟？（1 刻钟 = 15 分钟）`,
        groupLabel: n => `${n} 刻钟`
      },
      {
        key: 'clock-half', per: 30, minN: 2, maxN: 3, unit: '分钟', cell: '',
        tip: '半小时 = 30 分钟',
        text: n => `${n} 个半小时是多少分钟？`,
        groupLabel: n => `${n} 个半小时`
      },
      {
        key: 'clock-hour', per: 60, minN: 2, maxN: 3, unit: '分钟', cell: '',
        tip: '1 小时 = 60 分钟',
        text: n => `${n} 小时一共是多少分钟？`,
        groupLabel: n => `${n} 小时`
      }
    ]
  },
  {
    id: 'money',
    name: '钱币城',
    icon: '💰',
    color: '#feca57',
    desc: '1 元 = 10 角，1 角 = 10 分',
    count: 8,
    templates: [
      {
        key: 'yuan2jiao', per: 10, minN: 2, maxN: 9, unit: '角', cell: '',
        tip: '1 元 = 10 角',
        text: n => `${n} 元可以换成多少角？`,
        groupLabel: n => `${n} 元`
      },
      {
        key: 'jiao2fen', per: 10, minN: 2, maxN: 6, unit: '分', cell: '',
        tip: '1 角 = 10 分',
        text: n => `${n} 角可以换成多少分？`,
        groupLabel: n => `${n} 角`
      },
      {
        key: 'coin5jiao', per: 5, minN: 2, maxN: 9, unit: '角', cell: '🪙',
        tip: '一枚硬币 5 角',
        text: n => `5 角的硬币有 ${n} 枚，一共是多少角？`,
        groupLabel: n => `${n} 枚`
      },
      {
        key: 'note2yuan', per: 2, minN: 2, maxN: 9, unit: '元', cell: '💵',
        tip: '一张纸币 2 元',
        text: n => `2 元的纸币有 ${n} 张，一共是多少元？`,
        groupLabel: n => `${n} 张`
      },
      {
        key: 'note5yuan', per: 5, minN: 2, maxN: 6, unit: '元', cell: '💵',
        tip: '一张纸币 5 元',
        text: n => `5 元的纸币有 ${n} 张，一共是多少元？`,
        groupLabel: n => `${n} 张`
      },
      {
        key: 'buy-pencil', per: 3, minN: 2, maxN: 8, unit: '元', cell: '✏️',
        tip: '一支铅笔 3 元',
        text: n => `一支铅笔 3 元，买 ${n} 支要多少元？`,
        groupLabel: n => `${n} 支`
      }
    ]
  },
  {
    id: 'week',
    name: '星期森林',
    icon: '📅',
    color: '#00d2d3',
    desc: '一个星期 7 天',
    count: 8,
    templates: [
      {
        key: 'week-days', per: 7, minN: 2, maxN: 5, unit: '天', cell: '📆',
        tip: '1 个星期 = 7 天',
        text: n => `${n} 个星期一共有多少天？`,
        groupLabel: n => `${n} 个星期`
      },
      {
        key: 'school-days', per: 5, minN: 2, maxN: 8, unit: '天', cell: '🎒',
        tip: '一个星期上学 5 天',
        text: n => `一个星期上学 5 天，${n} 个星期上学多少天？`,
        groupLabel: n => `${n} 个星期`
      },
      {
        key: 'weekend', per: 2, minN: 2, maxN: 9, unit: '天', cell: '🛌',
        tip: '一个星期休息 2 天',
        text: n => `一个星期休息 2 天，${n} 个星期一共休息多少天？`,
        groupLabel: n => `${n} 个星期`
      },
      {
        key: 'pe-class', per: 3, minN: 2, maxN: 7, unit: '节', cell: '⚽',
        tip: '每星期 3 节体育课',
        text: n => `每个星期上 3 节体育课，${n} 个星期一共上多少节？`,
        groupLabel: n => `${n} 个星期`
      },
      {
        key: 'week-milk', per: 4, minN: 2, maxN: 7, unit: '盒', cell: '🥛',
        tip: '每星期喝 4 盒牛奶',
        text: n => `小红每星期喝 4 盒牛奶，${n} 个星期一共喝多少盒？`,
        groupLabel: n => `${n} 个星期`
      }
    ]
  },
  {
    id: 'calendar',
    name: '日历山',
    icon: '🌞',
    color: '#ff9f43',
    desc: '一天 24 小时，一年 12 个月',
    count: 8,
    templates: [
      {
        key: 'day-hours', per: 24, minN: 2, maxN: 4, unit: '小时', cell: '',
        tip: '1 天 = 24 小时',
        text: n => `${n} 天一共有多少小时？`,
        groupLabel: n => `${n} 天`
      },
      {
        key: 'year-months', per: 12, minN: 2, maxN: 4, unit: '个月', cell: '',
        tip: '1 年 = 12 个月',
        text: n => `${n} 年一共有多少个月？`,
        groupLabel: n => `${n} 年`
      },
      {
        key: 'meals', per: 3, minN: 2, maxN: 9, unit: '顿', cell: '🍚',
        tip: '每天吃 3 顿饭',
        text: n => `每天吃 3 顿饭，${n} 天一共吃多少顿？`,
        groupLabel: n => `${n} 天`
      },
      {
        key: 'sleep', per: 9, minN: 2, maxN: 4, unit: '小时', cell: '😴',
        tip: '每天睡 9 小时',
        text: n => `小朋友每天睡 9 小时，${n} 天一共睡多少小时？`,
        groupLabel: n => `${n} 天`
      },
      {
        key: 'month-weeks', per: 4, minN: 2, maxN: 6, unit: '个星期', cell: '📅',
        tip: '1 个月大约 4 个星期',
        text: n => `一个月大约有 4 个星期，${n} 个月大约有多少个星期？`,
        groupLabel: n => `${n} 个月`
      }
    ]
  },
  {
    id: 'life',
    name: '生活百宝箱',
    icon: '🧺',
    color: '#a29bfe',
    desc: '一双袜子、一辆小车、一盒鸡蛋',
    count: 8,
    templates: [
      {
        key: 'socks', per: 2, minN: 2, maxN: 9, unit: '只', cell: '🧦',
        tip: '一双袜子 2 只',
        text: n => `一双袜子有 2 只，${n} 双一共有多少只？`,
        groupLabel: n => `${n} 双`
      },
      {
        key: 'fingers', per: 5, minN: 2, maxN: 9, unit: '个手指', cell: '👆',
        tip: '一只手 5 个手指',
        text: n => `一只手有 5 个手指，${n} 只手一共有多少个手指？`,
        groupLabel: n => `${n} 只手`
      },
      {
        key: 'car-wheels', per: 4, minN: 2, maxN: 9, unit: '个轮子', cell: '🛞',
        tip: '一辆小汽车 4 个轮子',
        text: n => `一辆小汽车有 4 个轮子，${n} 辆一共有多少个轮子？`,
        groupLabel: n => `${n} 辆`
      },
      {
        key: 'eggs', per: 6, minN: 2, maxN: 6, unit: '个', cell: '🥚',
        tip: '一盒鸡蛋 6 个',
        text: n => `一盒鸡蛋有 6 个，${n} 盒一共有多少个？`,
        groupLabel: n => `${n} 盒`
      },
      {
        key: 'pencils', per: 8, minN: 2, maxN: 5, unit: '支', cell: '✏️',
        tip: '一包铅笔 8 支',
        text: n => `一包铅笔有 8 支，${n} 包一共有多少支？`,
        groupLabel: n => `${n} 包`
      },
      {
        key: 'chick-legs', per: 2, minN: 3, maxN: 9, unit: '条腿', cell: '🐤',
        tip: '一只小鸡 2 条腿',
        text: n => `一只小鸡有 2 条腿，${n} 只小鸡一共有多少条腿？`,
        groupLabel: n => `${n} 只`
      },
      {
        key: 'dog-legs', per: 4, minN: 2, maxN: 8, unit: '条腿', cell: '🐶',
        tip: '一只小狗 4 条腿',
        text: n => `一只小狗有 4 条腿，${n} 只小狗一共有多少条腿？`,
        groupLabel: n => `${n} 只`
      },
      {
        key: 'yogurt', per: 4, minN: 2, maxN: 6, unit: '瓶', cell: '🥛',
        tip: '一排酸奶 4 瓶',
        text: n => `一排酸奶有 4 瓶，${n} 排一共有多少瓶？`,
        groupLabel: n => `${n} 排`
      }
    ]
  }
];

function randInt(min, max, rng) {
  return min + Math.floor(rng() * (max - min + 1));
}

function shuffle(list, rng) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

// 干扰项按「一年级最容易犯的错」排：少算一份、多算一份、把乘法当成加法、差 1、差 10
function makeOptions(answer, groups, per, rng) {
  const candidates = [
    answer - per,
    answer + per,
    groups + per,
    answer + 1,
    answer - 1,
    answer + 10,
    answer - 10,
    answer + 2
  ];
  const wrong = [];
  for (let i = 0; i < candidates.length && wrong.length < 5; i++) {
    const v = candidates[i];
    if (v > 0 && v !== answer && wrong.indexOf(v) === -1) wrong.push(v);
  }
  const picked = shuffle(wrong, rng).slice(0, 3);
  return shuffle(picked.concat([answer]), rng);
}

function makeQuestion(level, tpl, groups, rng) {
  const per = tpl.per;
  const answer = per * groups;
  // 一份不超过 12 个、总数不超过 36 个才画小图标，否则用数字卡片
  const drawable = !!tpl.cell && per <= 12 && answer <= 36;
  const addition = groups <= 6 && per <= 12
    ? new Array(groups).fill(per).join(' + ') + ' = ' + answer
    : '';

  return {
    levelId: level.id,
    key: tpl.key,
    text: tpl.text(groups),
    tip: tpl.tip,
    unit: tpl.unit,
    groups: groups,
    per: per,
    answer: answer,
    options: makeOptions(answer, groups, per, rng),
    formula: per + ' × ' + groups + ' = ' + answer,
    addition: addition,
    chant: chantOf(per, groups),
    cell: drawable ? tpl.cell : '',
    groupLabel: tpl.groupLabel(groups)
  };
}

// 生成一关的题目：不重复出现「同模板同份数」，并按答案从小到大排，难度逐步上升
function buildLevel(levelId, opts) {
  const options = opts || {};
  const rng = options.rng || Math.random;
  const level = getLevel(levelId);
  if (!level) return [];
  const count = options.count || level.count;

  const used = {};
  const list = [];
  let guard = 0;
  while (list.length < count && guard < count * 40) {
    guard++;
    const tpl = level.templates[randInt(0, level.templates.length - 1, rng)];
    const groups = randInt(tpl.minN, tpl.maxN, rng);
    const stamp = tpl.key + ':' + groups;
    if (used[stamp]) continue;
    used[stamp] = true;
    list.push(makeQuestion(level, tpl, groups, rng));
  }
  list.sort((x, y) => x.answer - y.answer);
  return list;
}

function getLevel(levelId) {
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].id === levelId) return LEVELS[i];
  }
  return null;
}

const Questions = {
  levels: LEVELS,
  getLevel: getLevel,
  buildLevel: buildLevel,
  chantOf: chantOf,
  num2cn: num2cn
};

if (typeof module !== 'undefined' && module.exports) module.exports = Questions;
else if (typeof window !== 'undefined') window.Questions = Questions;
