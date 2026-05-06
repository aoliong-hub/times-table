// table.js - 动手建造区
const Table = {
  isDragging: false,
  dragItem: null,
  challengeTarget: null,
  lockedValue: null,
  _celebrating: false,

  colors: {
    1: '#FF6B6B', 2: '#48dbfb', 3: '#feca57', 4: '#ff9ff3',
    5: '#00d2d3', 6: '#54a0ff', 7: '#ff9f43', 8: '#a29bfe', 9: '#fd79a8'
  },

  chineseNumbers: {
    1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
    6: '六', 7: '七', 8: '八', 9: '九'
  },

  init() {
    this.setupBuilder();
  },

  // 设置建造区
  setupBuilder() {
    this.renderShelfItems();
    this.setupDragAndDrop();
    this.setupBaseControls();
    this.setupTutorial();
    if (!Storage.get('tutorialDone', false)) {
      this.showTutorial();
    }
  },

  // 设置教程
  setupTutorial() {
    const helpBtn = document.getElementById('showTutorial');
    if (helpBtn) helpBtn.addEventListener('click', () => this.showTutorial());
  },

  // 显示教程
  showTutorial() {
    const overlay = document.getElementById('tutorialOverlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="tutorial-modal">
        <div class="tutorial-hero-icon">🦸</div>
        <h3>怎么玩？</h3>
        <div class="tutorial-steps">
          <div class="tutorial-step">
            <div class="step-num">1</div>
            <div class="step-content">
              <div class="step-icon">👆</div>
              <div class="step-text">选拖一个数字</div>
            </div>
          </div>
          <div class="tutorial-step">
            <div class="step-num">2</div>
            <div class="step-content">
              <div class="step-icon">🏠</div>
              <div class="step-text">放进基地</div>
            </div>
          </div>
          <div class="tutorial-step">
            <div class="step-num">3</div>
            <div class="step-content">
              <div class="step-icon">✨</div>
              <div class="step-text">发现口诀</div>
            </div>
          </div>
        </div>
        <div class="tutorial-example">
          <div class="example-desc">拖2到3个基地</div>
          <div class="example-flow">
            <span class="ex-base">🏠🏠🏠</span>
            <span class="ex-arrow">→</span>
            <span class="ex-result">2+2+2=6</span>
            <span class="ex-arrow">→</span>
            <span class="ex-mul">二三得六</span>
          </div>
        </div>
        <button class="btn-primary tutorial-close" id="closeTutorial">知道了！</button>
      </div>
    `;

    document.getElementById('closeTutorial').addEventListener('click', () => {
      overlay.style.display = 'none';
      Storage.set('tutorialDone', true);
    });
  },

  // 渲染物品栏
  renderShelfItems() {
    const shelf = document.getElementById('shelfItems');
    if (!shelf) return;

    let html = '';
    for (let i = 1; i <= 9; i++) {
      html += `
        <div class="shelf-item" data-value="${i}" draggable="true">
          <div class="item-circle" style="background: ${this.colors[i]}">
            <span class="item-number">${i}</span>
          </div>
        </div>
      `;
    }
    shelf.innerHTML = html;
  },

  // 更新物品栏锁定状态
  updateShelfLock() {
    const items = document.querySelectorAll('.shelf-item');
    items.forEach(item => {
      const value = parseInt(item.dataset.value);
      if (this.lockedValue !== null && value !== this.lockedValue) {
        item.classList.add('locked');
        item.draggable = false;
      } else {
        item.classList.remove('locked');
        item.draggable = true;
      }
    });
  },

  // 设置拖拽
  setupDragAndDrop() {
    const shelf = document.getElementById('shelfItems');
    const basesContainer = document.getElementById('basesContainer');
    if (!shelf || !basesContainer) return;

    shelf.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.shelf-item');
      if (!item || item.classList.contains('locked')) return;
      this.isDragging = true;
      this.dragItem = parseInt(item.dataset.value);
      e.dataTransfer.setData('text/plain', this.dragItem);
      e.dataTransfer.effectAllowed = 'copy';
      item.classList.add('dragging');
    });

    shelf.addEventListener('dragend', (e) => {
      const item = e.target.closest('.shelf-item');
      if (item) item.classList.remove('dragging');
      this.isDragging = false;
    });

    basesContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const base = this.getBaseAtPosition(e.clientX, e.clientY);
      document.querySelectorAll('.base').forEach(b => b.classList.remove('drag-over'));
      if (base) base.classList.add('drag-over');
    });

    basesContainer.addEventListener('dragleave', () => {
      document.querySelectorAll('.base').forEach(b => b.classList.remove('drag-over'));
    });

    basesContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      document.querySelectorAll('.base').forEach(b => b.classList.remove('drag-over'));
      const value = parseInt(e.dataTransfer.getData('text/plain'));
      if (!value) return;
      const base = this.getBaseAtPosition(e.clientX, e.clientY);
      if (base) this.addValueToBase(base, value);
    });

    this.setupTouchDrag();
  },

  // 触屏拖拽
  setupTouchDrag() {
    const shelf = document.getElementById('shelfItems');
    if (!shelf) return;

    let touchClone = null;

    shelf.addEventListener('touchstart', (e) => {
      const item = e.target.closest('.shelf-item');
      if (!item || item.classList.contains('locked')) return;

      this.dragItem = parseInt(item.dataset.value);
      touchClone = document.createElement('div');
      touchClone.className = 'touch-clone';
      touchClone.innerHTML = `<div class="item-circle" style="background: ${this.colors[this.dragItem]}">${this.dragItem}</div>`;
      touchClone.style.position = 'fixed';
      touchClone.style.pointerEvents = 'none';
      touchClone.style.zIndex = '1000';
      document.body.appendChild(touchClone);

      const touch = e.touches[0];
      touchClone.style.left = (touch.clientX - 20) + 'px';
      touchClone.style.top = (touch.clientY - 20) + 'px';
    });

    document.addEventListener('touchmove', (e) => {
      if (!touchClone) return;
      e.preventDefault();
      const touch = e.touches[0];
      touchClone.style.left = (touch.clientX - 20) + 'px';
      touchClone.style.top = (touch.clientY - 20) + 'px';
      const base = this.getBaseAtPosition(touch.clientX, touch.clientY);
      document.querySelectorAll('.base').forEach(b => b.classList.remove('drag-over'));
      if (base) base.classList.add('drag-over');
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      if (!touchClone) return;
      const touch = e.changedTouches[0];
      const base = this.getBaseAtPosition(touch.clientX, touch.clientY);
      if (base && this.dragItem) this.addValueToBase(base, this.dragItem);
      touchClone.remove();
      touchClone = null;
      this.dragItem = null;
      document.querySelectorAll('.base').forEach(b => b.classList.remove('drag-over'));
    });
  },

  // 获取位置对应的基地
  getBaseAtPosition(x, y) {
    const bases = document.querySelectorAll('.base');
    for (const base of bases) {
      const rect = base.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return base;
      }
    }
    return null;
  },

  // 添加数值到基地
  addValueToBase(base, value) {
    const baseValue = base.querySelector('.base-value');
    const currentValue = baseValue.textContent;

    if (currentValue && currentValue !== '?') {
      this.showNotification('这个基地已经有数字了！', 'warning');
      return;
    }

    if (this.lockedValue === null) {
      this.lockedValue = value;
      this.updateShelfLock();
    }

    baseValue.textContent = value;
    baseValue.style.background = this.colors[value];
    baseValue.style.color = 'white';
    baseValue.classList.add('filled');
    base.classList.add('has-value');

    this.updateResult();
    this.createDropEffect(base);
  },

  // 更新结果显示
  updateResult() {
    const bases = document.querySelectorAll('.base');
    let filledCount = 0;
    let value = 0;

    bases.forEach(base => {
      const baseValue = base.querySelector('.base-value');
      if (baseValue.classList.contains('filled')) {
        filledCount++;
        value = parseInt(baseValue.textContent);
      }
    });

    const additionEl = document.getElementById('resultAddition');
    const multiplicationEl = document.getElementById('resultMultiplication');
    const chineseEl = document.getElementById('resultChinese');
    const commutativeBtn = document.getElementById('btnCommutative');

    if (filledCount === 0) {
      additionEl.textContent = '';
      multiplicationEl.textContent = '';
      multiplicationEl.style.display = 'none';
      chineseEl.textContent = '';
      if (commutativeBtn) commutativeBtn.style.display = 'none';
      return;
    }

    const addParts = [];
    for (let i = 0; i < filledCount; i++) {
      addParts.push(`<span class="eq-num">${value}</span>`);
    }
    additionEl.innerHTML = addParts.join('<span class="eq-op">+</span>') +
      `<span class="eq-op">=</span><span class="eq-result">${filledCount * value}</span>`;

    if (filledCount >= 2) {
      const result = filledCount * value;
      multiplicationEl.style.display = 'block';
      multiplicationEl.className = 'result-multiplication';
      multiplicationEl.innerHTML = `
        <span class="eq-mul">${filledCount}×${value}=${result}</span>
        <span class="eq-chinese">${this.getChinesePhrase(filledCount, value)}</span>
      `;

      if (commutativeBtn && !this.challengeTarget && filledCount !== value) {
        commutativeBtn.style.display = 'inline-block';
        commutativeBtn.textContent = `转一转：${filledCount}×${value} = ${value}×${filledCount}`;
      } else if (commutativeBtn) {
        commutativeBtn.style.display = 'none';
      }

      const wasChallenge = !!this.challengeTarget;
      this.checkChallenge(result);

      if (!wasChallenge && !this._skipCelebration && filledCount === bases.length && bases.length >= 2) {
        this.showAllFilledCelebration();
      }
    } else if (filledCount === 1) {
      multiplicationEl.style.display = 'block';
      multiplicationEl.className = 'result-multiplication';
      multiplicationEl.innerHTML = `
        <span class="eq-mul">1×${value}=${value}</span>
        <span class="eq-chinese">${this.getChinesePhrase(1, value)}</span>
      `;
      chineseEl.textContent = this.challengeTarget ? '' : '再放一个相同的数字，发现更多口诀！';
      if (commutativeBtn) commutativeBtn.style.display = 'none';
    } else {
      multiplicationEl.style.display = 'none';
      chineseEl.textContent = '';
      if (commutativeBtn) commutativeBtn.style.display = 'none';
    }
  },

  // 获取中文口诀
  getChinesePhrase(a, b) {
    if (a > b) [a, b] = [b, a];
    const result = a * b;
    const aChinese = this.chineseNumbers[a];
    const bChinese = this.chineseNumbers[b];
    const resultChinese = this.numberToChinese(result);
    if (result <= 10) {
      return `${aChinese}${bChinese}得${resultChinese}`;
    }
    return `${aChinese}${bChinese}${resultChinese}`;
  },

  // 数字转中文
  numberToChinese(num) {
    if (num <= 10) {
      const map = { 0: '零', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' };
      return map[num];
    }
    if (num < 20) return '十' + this.numberToChinese(num - 10);
    if (num < 100) {
      const tens = Math.floor(num / 10);
      const ones = num % 10;
      return this.chineseNumbers[tens] + '十' + (ones ? this.numberToChinese(ones) : '');
    }
    return num.toString();
  },

  // 检查挑战
  checkChallenge(result) {
    if (this.challengeTarget && result === this.challengeTarget) {
      this.challengeTarget = null;
      const banner = document.getElementById('challengeBanner');
      if (banner) banner.style.display = 'none';
      this.showCelebration('挑战成功！', '太棒了，再来一次吧！');
    }
  },

  // 统一庆祝效果
  showCelebration(title, subtitle) {
    if (this._celebrating) return;
    this._celebrating = true;

    this.createFireworks();

    setTimeout(() => {
      const hero = document.createElement('div');
      hero.className = 'flying-hero';
      hero.innerHTML = '<img src="ims.webp" class="flying-hero-img">';
      document.body.appendChild(hero);
      setTimeout(() => hero.remove(), 4000);
    }, 500);

    setTimeout(() => {
      const modal = document.createElement('div');
      modal.className = 'encouragement-modal';
      modal.innerHTML = `
        <div class="encouragement-content">
          <div class="encouragement-hero"><img src="ims.webp" class="modal-hero-img"></div>
          <div class="encouragement-text">${title}</div>
          <div class="encouragement-sub">${subtitle}</div>
          <button class="btn-primary encouragement-btn" id="closeCelebration">好的！</button>
        </div>
      `;
      document.body.appendChild(modal);
      setTimeout(() => modal.classList.add('active'), 10);

      document.getElementById('closeCelebration').addEventListener('click', () => {
        modal.classList.remove('active');
        setTimeout(() => {
          modal.remove();
          this._celebrating = false;
          this.resetState();
          this.initBases(2 + Math.floor(Math.random() * 8));
        }, 300);
      });

      setTimeout(() => {
        if (document.body.contains(modal)) {
          modal.classList.remove('active');
          setTimeout(() => {
            modal.remove();
            this._celebrating = false;
          }, 300);
        }
      }, 4000);
    }, 5000);
  },

  // 创建烟花效果
  createFireworks() {
    const container = document.createElement('div');
    container.className = 'fireworks-container';
    document.body.appendChild(container);

    for (let round = 0; round < 5; round++) {
      setTimeout(() => {
        const x = 10 + Math.random() * 80;
        const y = 10 + Math.random() * 40;

        for (let i = 0; i < 30; i++) {
          const particle = document.createElement('div');
          particle.className = 'firework-particle';
          particle.style.left = x + '%';
          particle.style.top = y + '%';

          const angle = (Math.PI * 2 * i) / 30;
          const distance = 50 + Math.random() * 100;
          const tx = Math.cos(angle) * distance;
          const ty = Math.sin(angle) * distance;
          particle.style.setProperty('--tx', tx + 'px');
          particle.style.setProperty('--ty', ty + 'px');
          particle.style.background = this.getRandomColor();
          particle.style.animationDelay = (Math.random() * 0.3) + 's';

          container.appendChild(particle);
        }
      }, round * 400);
    }

    setTimeout(() => container.remove(), 3000);
  },

  getRandomColor() {
    const colors = ['#FF6B6B', '#48dbfb', '#feca57', '#ff9ff3', '#00d2d3', '#54a0ff', '#ff9f43', '#a29bfe', '#fd79a8', '#FFD700', '#00FF88'];
    return colors[Math.floor(Math.random() * colors.length)];
  },

  showAllFilledCelebration() {
    this.showCelebration('你真棒！', '所有基地都填满啦！');
  },

  // 设置基地控制
  setupBaseControls() {
    document.getElementById('addBase')?.addEventListener('click', () => this.addBase());
    document.getElementById('clearBuilder')?.addEventListener('click', () => this.clearBuilder());
    document.getElementById('randomChallenge')?.addEventListener('click', () => this.startChallenge());
    document.getElementById('btnCommutative')?.addEventListener('click', () => this.showCommutative());
    document.getElementById('closeChallenge')?.addEventListener('click', () => this.closeChallenge());

    this.initBases(3);
  },

  // 初始化基地
  initBases(count) {
    const container = document.getElementById('basesContainer');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      this.addBase();
    }
    this.updateBaseSizes();
    this.updateShelfLock();
  },

  // 添加基地
  addBase() {
    const container = document.getElementById('basesContainer');
    if (!container) return;

    if (container.children.length >= 9) {
      this.showNotification('最多9个基地！', 'warning');
      return;
    }

    const index = container.children.length;
    const base = document.createElement('div');
    base.className = 'base';
    base.dataset.index = index;
    base.innerHTML = `
      <div class="base-roof">
        <div class="base-flag">🚩</div>
      </div>
      <div class="base-body">
        <div class="base-header">
          <span class="base-label">基地 ${index + 1}</span>
          <button class="base-delete" title="删除">×</button>
        </div>
        <div class="base-value">?</div>
        <div class="base-hint">拖数字到这里</div>
      </div>
    `;

    base.querySelector('.base-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeBase(base);
    });

    container.appendChild(base);
    base.style.animation = 'slideInUp 0.3s ease-out';
    this.updateBaseSizes();
  },

  // 删除基地
  removeBase(base) {
    const container = document.getElementById('basesContainer');
    if (!container || container.children.length <= 1) {
      this.showNotification('至少保留一个基地！', 'warning');
      return;
    }

    base.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => {
      base.remove();
      container.querySelectorAll('.base').forEach((b, i) => {
        b.dataset.index = i;
        b.querySelector('.base-label').textContent = `基地 ${i + 1}`;
      });
      this.updateBaseSizes();
      this.updateResult();
      this.recheckLockedValue();
    }, 300);
  },

  // 检查 lockedValue 是否仍然有效
  recheckLockedValue() {
    if (this.lockedValue === null) return;
    const bases = document.querySelectorAll('.base');
    let hasLocked = false;
    bases.forEach(base => {
      const val = base.querySelector('.base-value');
      if (val.classList.contains('filled') && parseInt(val.textContent) === this.lockedValue) {
        hasLocked = true;
      }
    });
    if (!hasLocked) {
      this.lockedValue = null;
      this.updateShelfLock();
    }
  },

  // 更新基地布局
  updateBaseSizes() {
    const container = document.getElementById('basesContainer');
    if (!container) return;

    const count = container.children.length;
    let columns;
    if (count === 1) columns = 1;
    else if (count <= 4) columns = 2;
    else columns = 3;

    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  },

  // 重置状态（不操作 DOM）
  resetState() {
    this.lockedValue = null;
    this._celebrating = false;
    document.querySelectorAll('.flying-hero, .fireworks-container, .encouragement-modal').forEach(el => el.remove());
    this.clearResultDisplay();
  },

  // 清理结果显示
  clearResultDisplay() {
    const additionEl = document.getElementById('resultAddition');
    const multiplicationEl = document.getElementById('resultMultiplication');
    const chineseEl = document.getElementById('resultChinese');
    const commutativeBtn = document.getElementById('btnCommutative');
    if (additionEl) additionEl.textContent = '';
    if (multiplicationEl) { multiplicationEl.style.display = 'none'; multiplicationEl.textContent = ''; }
    if (chineseEl) chineseEl.textContent = '';
    if (commutativeBtn) commutativeBtn.style.display = 'none';
  },

  // 清空建造区
  clearBuilder() {
    this.resetState();
    this.initBases(2 + Math.floor(Math.random() * 8));
  },

  // 开始挑战
  startChallenge() {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'difficultyModal';
    modal.innerHTML = `
      <div class="modal-content difficulty-content">
        <h3>选择挑战难度</h3>
        <div class="difficulty-buttons">
          <button class="diff-btn easy" data-diff="easy">
            <span class="diff-icon">🌟</span>
            <span class="diff-name">容易</span>
            <span class="diff-desc">小数字</span>
          </button>
          <button class="diff-btn medium" data-diff="medium">
            <span class="diff-icon">🔥</span>
            <span class="diff-name">中等</span>
            <span class="diff-desc">中等数字</span>
          </button>
          <button class="diff-btn hard" data-diff="hard">
            <span class="diff-icon">⚡</span>
            <span class="diff-name">困难</span>
            <span class="diff-desc">大数字</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const diff = btn.dataset.diff;
        modal.remove();
        this.startChallengeWithDifficulty(diff);
      });
    });
  },

  // 根据难度开始挑战
  startChallengeWithDifficulty(difficulty) {
    const targetsByDifficulty = {
      easy: [4, 6, 8, 9, 10],
      medium: [12, 15, 16, 18, 20],
      hard: [24, 27, 30, 36, 45]
    };

    const targets = targetsByDifficulty[difficulty] || targetsByDifficulty.easy;
    this.challengeTarget = targets[Math.floor(Math.random() * targets.length)];

    const banner = document.getElementById('challengeBanner');
    const text = document.getElementById('challengeText');

    const diffLabels = {
      easy: '🌟 容易：',
      medium: '🔥 中等：',
      hard: '⚡ 困难：'
    };

    text.textContent = `${diffLabels[difficulty]}拼出${this.challengeTarget}！`;
    banner.style.display = 'flex';

    const baseCount = this.getChallengeBaseCount(this.challengeTarget);
    this.resetState();
    this.initBases(baseCount);
    this.showNotification('开始挑战！', 'info');
  },

  // 根据挑战目标计算基地数量
  getChallengeBaseCount(target) {
    const factors = [];
    for (let i = 2; i <= 9; i++) {
      if (target % i === 0 && target / i <= 9) {
        factors.push(i);
      }
    }
    if (factors.length > 0) {
      return factors[Math.floor(Math.random() * factors.length)];
    }
    return 3;
  },

  // 关闭挑战
  closeChallenge() {
    this.challengeTarget = null;
    const banner = document.getElementById('challengeBanner');
    if (banner) banner.style.display = 'none';
  },

  // 交换律展示
  showCommutative() {
    const bases = document.querySelectorAll('.base');
    let filledCount = 0;
    let value = 0;

    bases.forEach(base => {
      const baseValue = base.querySelector('.base-value');
      if (baseValue.classList.contains('filled')) {
        filledCount++;
        value = parseInt(baseValue.textContent);
      }
    });

    if (filledCount === value) return;

    this.resetState();
    this.initBases(value);

    setTimeout(() => {
      this.lockedValue = filledCount;
      this.updateShelfLock();

      const bases = document.querySelectorAll('.base');
      bases.forEach(base => {
        const baseValue = base.querySelector('.base-value');
        baseValue.textContent = filledCount;
        baseValue.style.background = this.colors[filledCount];
        baseValue.style.color = 'white';
        baseValue.classList.add('filled');
        base.classList.add('has-value');
      });

      this._skipCelebration = true;
      this.updateResult();
      this._skipCelebration = false;
      this.showNotification(`看！${filledCount}×${value} = ${value}×${filledCount}`, 'success');
    }, 300);
  },

  // 创建放置效果
  createDropEffect(base) {
    const rect = base.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    for (let i = 0; i < 8; i++) {
      const particle = document.createElement('div');
      particle.className = 'drop-particle';
      particle.style.left = x + 'px';
      particle.style.top = y + 'px';
      particle.style.background = this.colors[Math.floor(Math.random() * 9) + 1];
      particle.style.setProperty('--tx', (Math.random() * 60 - 30) + 'px');
      particle.style.setProperty('--ty', (Math.random() * 60 - 30) + 'px');
      document.body.appendChild(particle);
      setTimeout(() => particle.remove(), 500);
    }
  },

  showNotification(message, type = 'info') {
    if (typeof App !== 'undefined' && App.showNotification) {
      App.showNotification(message, type);
    }
  }
};
