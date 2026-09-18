// game.js - 一局游戏的计分引擎（纯逻辑，不依赖 DOM / wx API）
// 用法：const g = Game.create('clock'); g.current(); g.answer(30); g.finished
// 浏览器里 questions.js 已声明全局 Questions，这里必须换个名字，否则重复声明会让本文件整体失效
const QBank = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./questions.js')
  : window.Questions;

// 计分：答对基础 10 分；连对第 2 题起每题多 5 分，最多 +20；
// 第一次就答对额外 +5（鼓励一次想清楚，而不是乱点）
const BASE_SCORE = 10;
const COMBO_STEP = 5;
const COMBO_MAX_BONUS = 20;
const FIRST_TRY_BONUS = 5;

// 每题最多 2 次机会：第一次错了给提示再试一次，第二次错了公布答案
const MAX_TRIES = 2;

function starsOf(score, total) {
  if (total <= 0) return 0;
  const rate = score / total;
  if (rate >= 0.9) return 3;
  if (rate >= 0.7) return 2;
  if (rate >= 0.4) return 1;
  return 0;
}

const Game = {
  create(levelId, opts) {
    const options = opts || {};
    const list = QBank.buildLevel(levelId, options);

    return {
      levelId: levelId,
      questions: list,
      index: 0,
      tries: 0,          // 当前题已用掉的机会
      score: 0,
      combo: 0,          // 当前连对数
      bestCombo: 0,
      rightCount: 0,     // 一次答对的题数
      wrongCount: 0,     // 用掉 2 次机会仍没答对的题数
      finished: false,
      history: [],

      current() {
        return this.questions[this.index] || null;
      },

      // 满分：每题都一次答对，含连对奖励
      maxScore() {
        let total = 0;
        for (let i = 0; i < this.questions.length; i++) {
          const bonus = Math.min(i * COMBO_STEP, COMBO_MAX_BONUS);
          total += BASE_SCORE + FIRST_TRY_BONUS + bonus;
        }
        return total;
      },

      progress() {
        return { done: this.index, total: this.questions.length };
      },

      // 返回 { correct, gain, combo, retry, revealed, answer, question, finished }
      // retry=true 表示还有机会，题目不前进；revealed=true 表示机会用完，公布答案
      answer(value) {
        const q = this.current();
        if (this.finished || !q) {
          return { correct: false, gain: 0, combo: this.combo, retry: false, revealed: false, answer: null, question: null, finished: true };
        }

        this.tries++;
        const correct = Number(value) === q.answer;
        let gain = 0;

        if (correct) {
          const firstTry = this.tries === 1;
          const bonus = Math.min(this.combo * COMBO_STEP, COMBO_MAX_BONUS);
          gain = BASE_SCORE + bonus + (firstTry ? FIRST_TRY_BONUS : 0);
          this.score += gain;
          this.combo++;
          if (this.combo > this.bestCombo) this.bestCombo = this.combo;
          if (firstTry) this.rightCount++;
        } else if (this.tries < MAX_TRIES) {
          // 还有机会，连对先不清零，等这题真的失败才断
          return {
            correct: false, gain: 0, combo: this.combo, retry: true,
            revealed: false, answer: null, question: q, finished: false
          };
        } else {
          this.combo = 0;
          this.wrongCount++;
        }

        this.history.push({
          key: q.key, formula: q.formula, tries: this.tries, correct: correct, gain: gain
        });
        this.index++;
        this.tries = 0;
        if (this.index >= this.questions.length) this.finished = true;

        return {
          correct: correct,
          gain: gain,
          combo: this.combo,
          retry: false,
          revealed: !correct,
          answer: q.answer,
          question: q,
          finished: this.finished
        };
      },

      result() {
        const max = this.maxScore();
        return {
          levelId: this.levelId,
          score: this.score,
          maxScore: max,
          stars: starsOf(this.score, max),
          rightCount: this.rightCount,
          wrongCount: this.wrongCount,
          bestCombo: this.bestCombo,
          total: this.questions.length
        };
      }
    };
  },

  starsOf: starsOf,
  MAX_TRIES: MAX_TRIES
};

if (typeof module !== 'undefined' && module.exports) module.exports = Game;
else if (typeof window !== 'undefined') window.Game = Game;
