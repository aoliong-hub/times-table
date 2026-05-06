// progress.js - Achievement and progress tracking system
const Progress = {
  // Badge definitions
  badges: {
    first: {
      id: 'first',
      name: '觉醒之力',
      icon: '🌟',
      desc: '完成第一次训练',
      check: () => Storage.get('totalCorrect', 0) > 0
    },
    streak10: {
      id: 'streak10',
      name: '连击大师',
      icon: '🔥',
      desc: '连续答对10题',
      check: () => Storage.get('bestStreak', 0) >= 10
    },
    'table-master': {
      id: 'table-master',
      name: '口诀专家',
      icon: '💪',
      desc: '一个口诀表全掌握',
      check: () => {
        for (let i = 1; i <= 9; i++) {
          if (Storage.getNumberMastery(i) >= 90) return true;
        }
        return false;
      }
    },
    'all-master': {
      id: 'all-master',
      name: '数学超人',
      icon: '🦸',
      desc: '全部口诀表掌握',
      check: () => Storage.getTotalMastery() >= 90
    },
    gamer: {
      id: 'gamer',
      name: '任务达人',
      icon: '🎮',
      desc: '所有游戏通关',
      check: () => {
        const games = Storage.get('gamesPlayed', { balloon: 0, star: 0, cipher: 0 });
        return games.balloon > 0 && games.star > 0 && games.cipher > 0;
      }
    },
    speed: {
      id: 'speed',
      name: '闪电侠',
      icon: '⚡',
      desc: '60秒答对20题',
      check: () => Storage.get('speedChallenge', false)
    }
  },

  // Initialize progress module
  init() {
    this.renderAchievements();
    this.updateStats();
  },

  // Check and unlock achievements
  checkAchievements() {
    Object.values(this.badges).forEach(badge => {
      if (!Storage.hasBadge(badge.id) && badge.check()) {
        Storage.unlockBadge(badge.id);
        this.showBadgeUnlock(badge);
      }
    });

    // Update displays
    this.updateStats();
    this.renderAchievements();
  },

  // Show badge unlock notification
  showBadgeUnlock(badge) {
    const notification = document.createElement('div');
    notification.className = 'badge-notification';
    notification.innerHTML = `
      <div class="badge-notification-content">
        <div class="badge-notification-icon">${badge.icon}</div>
        <div class="badge-notification-text">
          <div class="badge-notification-title">解锁新勋章！</div>
          <div class="badge-notification-name">${badge.name}</div>
        </div>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.5s ease-in forwards';
      setTimeout(() => notification.remove(), 500);
    }, 3000);
  },

  // Update stats on home page
  updateStats() {
    const totalStars = document.getElementById('totalStars');
    const streak = document.getElementById('streak');
    const mastery = document.getElementById('mastery');

    if (totalStars) totalStars.textContent = Storage.get('stars', 0);
    if (streak) streak.textContent = Storage.get('streak', 0);
    if (mastery) mastery.textContent = Storage.getTotalMastery() + '%';
  },

  // Render achievements page
  renderAchievements() {
    this.renderBadges();
    this.renderMasteryGrid();
    this.renderCalendar();
    this.renderHeroShowcase();
  },

  // Render badge grid
  renderBadges() {
    const grid = document.getElementById('badgesGrid');
    if (!grid) return;

    grid.querySelectorAll('.badge').forEach(badgeEl => {
      const badgeId = badgeEl.dataset.badge;
      if (Storage.hasBadge(badgeId)) {
        badgeEl.classList.add('unlocked');
      } else {
        badgeEl.classList.remove('unlocked');
      }
    });
  },

  // Render mastery grid
  renderMasteryGrid() {
    const grid = document.getElementById('masteryGrid');
    if (!grid) return;

    let html = '';
    for (let i = 1; i <= 9; i++) {
      const mastery = Storage.getNumberMastery(i);
      const statusClass = mastery >= 80 ? 'mastered' : mastery > 0 ? 'learning' : '';

      html += `
        <div class="mastery-item ${statusClass}">
          <div class="mastery-label">${i}的口诀</div>
          <div class="mastery-bar">
            <div class="mastery-fill" style="width: ${mastery}%"></div>
          </div>
        </div>
      `;
    }

    grid.innerHTML = html;
  },

  // Render calendar
  renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;

    const days = Storage.getLast7Days();
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

    let html = '';
    days.forEach(day => {
      const date = new Date(day.date);
      const dayName = dayNames[date.getDay()];
      const activeClass = day.active ? 'active' : '';
      const todayClass = day.isToday ? 'today' : '';

      html += `
        <div class="calendar-day ${activeClass} ${todayClass}">
          <div class="day-label">${dayName}</div>
          <div class="day-icon">${day.active ? '⭐' : '○'}</div>
        </div>
      `;
    });

    grid.innerHTML = html;
  },

  // Render hero showcase
  renderHeroShowcase() {
    const showcaseHero = document.getElementById('showcaseHero');
    const levelFill = document.getElementById('levelFill');
    const heroLevel = document.getElementById('heroLevel');
    const showcaseCape = document.getElementById('showcaseCape');
    const showcaseCrown = document.getElementById('showcaseCrown');

    if (showcaseHero) {
      const equippedState = Hero.getEquippedState();
      const body = showcaseHero.querySelector('.hero-body');
      if (body) {
        body.classList.toggle('equipped', equippedState.equipped);
        body.classList.toggle('gold', equippedState.gold);
      }

      if (showcaseCrown) {
        showcaseCrown.style.display = equippedState.crown ? 'block' : 'none';
      }

      if (showcaseCape && equippedState.gold) {
        showcaseCape.style.background = 'linear-gradient(180deg, #FFD700, #ff8c00)';
      }
    }

    if (levelFill) {
      const level = Storage.get('level', 1);
      const exp = Storage.get('exp', 0);
      const expNeeded = level * 100;
      const percentage = Math.min(100, (exp / expNeeded) * 100);
      levelFill.style.width = percentage + '%';
    }

    if (heroLevel) {
      heroLevel.textContent = Storage.get('level', 1);
    }
  }
};

// Add notification styles
const progressStyles = document.createElement('style');
progressStyles.textContent = `
  .badge-notification {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 2000;
    animation: slideInRight 0.5s ease-out;
  }

  .badge-notification-content {
    display: flex;
    align-items: center;
    gap: 15px;
    background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 215, 0, 0.1));
    border: 2px solid var(--energy-gold);
    border-radius: 16px;
    padding: 20px 25px;
    backdrop-filter: blur(10px);
    box-shadow: 0 0 30px rgba(255, 215, 0, 0.3);
  }

  .badge-notification-icon {
    font-size: 40px;
  }

  .badge-notification-title {
    font-size: 14px;
    color: var(--text-light);
    margin-bottom: 4px;
  }

  .badge-notification-name {
    font-size: 20px;
    font-weight: 700;
    color: var(--energy-gold);
  }

  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slideOutRight {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(progressStyles);
