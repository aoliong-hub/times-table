// storage.js - localStorage wrapper for game data
const Storage = {
  PREFIX: 'mathHero_',

  // Get data from localStorage
  get(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(this.PREFIX + key);
      return data ? JSON.parse(data) : defaultValue;
    } catch (e) {
      console.error('Storage get error:', e);
      return defaultValue;
    }
  },

  // Save data to localStorage
  set(key, value) {
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage set error:', e);
      return false;
    }
  },

  // Remove data
  remove(key) {
    localStorage.removeItem(this.PREFIX + key);
  },

  // Get all game data
  getData() {
    return {
      stars: this.get('stars', 0),
      streak: this.get('streak', 0),
      bestStreak: this.get('bestStreak', 0),
      totalCorrect: this.get('totalCorrect', 0),
      totalAttempts: this.get('totalAttempts', 0),
      mastery: this.get('mastery', {}),
      badges: this.get('badges', []),
      activeDays: this.get('activeDays', []),
      gamesPlayed: this.get('gamesPlayed', { balloon: 0, star: 0, cipher: 0 }),
      level: this.get('level', 1),
      exp: this.get('exp', 0)
    };
  },

  // Save all game data
  saveData(data) {
    Object.entries(data).forEach(([key, value]) => {
      this.set(key, value);
    });
  },

  // Add stars
  addStars(amount) {
    const current = this.get('stars', 0);
    this.set('stars', current + amount);
    return current + amount;
  },

  // Update streak
  updateStreak(correct) {
    if (correct) {
      const streak = this.get('streak', 0) + 1;
      this.set('streak', streak);
      const bestStreak = this.get('bestStreak', 0);
      if (streak > bestStreak) {
        this.set('bestStreak', streak);
      }
      return streak;
    } else {
      this.set('streak', 0);
      return 0;
    }
  },

  // Update mastery for a specific multiplication
  updateMastery(a, b, correct) {
    const mastery = this.get('mastery', {});
    const key1 = `${a}x${b}`;
    const key2 = `${b}x${a}`;

    if (!mastery[key1]) {
      mastery[key1] = { correct: 0, attempts: 0 };
    }
    if (!mastery[key2]) {
      mastery[key2] = { correct: 0, attempts: 0 };
    }

    mastery[key1].attempts++;
    mastery[key2].attempts++;
    if (correct) {
      mastery[key1].correct++;
      mastery[key2].correct++;
    }

    this.set('mastery', mastery);
    return mastery;
  },

  // Get mastery level for a number (1-9)
  getNumberMastery(num) {
    const mastery = this.get('mastery', {});
    let totalCorrect = 0;
    let totalAttempts = 0;

    for (let i = 1; i <= 9; i++) {
      const key = `${num}x${i}`;
      if (mastery[key]) {
        totalCorrect += mastery[key].correct;
        totalAttempts += mastery[key].attempts;
      }
    }

    if (totalAttempts === 0) return 0;
    return Math.round((totalCorrect / totalAttempts) * 100);
  },

  // Get total mastery percentage
  getTotalMastery() {
    const mastery = this.get('mastery', {});
    let totalCorrect = 0;
    let totalAttempts = 0;

    Object.values(mastery).forEach(m => {
      totalCorrect += m.correct;
      totalAttempts += m.attempts;
    });

    if (totalAttempts === 0) return 0;
    return Math.round((totalCorrect / totalAttempts) * 100);
  },

  // Unlock badge
  unlockBadge(badgeId) {
    const badges = this.get('badges', []);
    if (!badges.includes(badgeId)) {
      badges.push(badgeId);
      this.set('badges', badges);
      return true; // New badge unlocked
    }
    return false; // Already had badge
  },

  // Check if badge is unlocked
  hasBadge(badgeId) {
    const badges = this.get('badges', []);
    return badges.includes(badgeId);
  },

  // Record active day
  recordActiveDay() {
    const today = new Date().toISOString().split('T')[0];
    const activeDays = this.get('activeDays', []);
    if (!activeDays.includes(today)) {
      activeDays.push(today);
      // Keep only last 30 days
      if (activeDays.length > 30) {
        activeDays.shift();
      }
      this.set('activeDays', activeDays);
    }
    return activeDays;
  },

  // Get last 7 days activity
  getLast7Days() {
    const activeDays = this.get('activeDays', []);
    const days = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      days.push({
        date: dateStr,
        active: activeDays.includes(dateStr),
        isToday: i === 0
      });
    }

    return days;
  },

  // Increment games played
  incrementGamePlayed(game) {
    const gamesPlayed = this.get('gamesPlayed', { balloon: 0, star: 0, cipher: 0 });
    gamesPlayed[game] = (gamesPlayed[game] || 0) + 1;
    this.set('gamesPlayed', gamesPlayed);
    return gamesPlayed;
  },

  // Add experience points
  addExp(amount) {
    const exp = this.get('exp', 0) + amount;
    const level = this.get('level', 1);
    const expNeeded = level * 100;

    if (exp >= expNeeded) {
      this.set('exp', exp - expNeeded);
      this.set('level', level + 1);
      return { levelUp: true, newLevel: level + 1, exp: exp - expNeeded };
    }

    this.set('exp', exp);
    return { levelUp: false, level, exp };
  },

  // Reset all data
  resetAll() {
    const keys = ['stars', 'streak', 'bestStreak', 'totalCorrect', 'totalAttempts',
      'mastery', 'badges', 'activeDays', 'gamesPlayed', 'level', 'exp'];
    keys.forEach(key => this.remove(key));
  }
};
