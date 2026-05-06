// table.js - 口诀能量站 3.0 - 建造与发现（最终版）
const Table = {
  // 状态
  currentRow: 1,
  unlockedRows: [1],
  isDragging: false,
  dragItem: null,
  challengeTarget: null,
  lockedValue: null, // 锁定的数字值

  // 颜色映射
  colors: {
    1: '#FF6B6B', 2: '#48dbfb', 3: '#feca57', 4: '#ff9ff3',
    5: '#00d2d3', 6: '#54a0ff', 7: '#ff9f43', 8: '#a29bfe', 9: '#fd79a8'
  },

  // 中文数字
  chineseNumbers: {
    1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
    6: '六', 7: '七', 8: '八', 9: '九'
  },

  // 口诀规律
  patterns: {
    1: { title: '1的口诀', desc: '任何数乘1等于自己', numbers: [1,2,3,4,5,6,7,8,9] },
    2: { title: '2的口诀', desc: '每次加2，都是偶数', numbers: [2,4,6,8,10,12,14,16,18] },
    3: { title: '3的口诀', desc: '每次加3', numbers: [3,6,9,12,15,18,21,24,27] },
    4: { title: '4的口诀', desc: '每次加4，都是偶数', numbers: [4,8,12,16,20,24,28,32,36] },
    5: { title: '5的口诀', desc: '尾数是0或5', numbers: [5,10,15,20,25,30,35,40,45] },
    6: { title: '6的口诀', desc: '每次加6', numbers: [6,12,18,24,30,36,42,48,54] },
    7: { title: '7的口诀', desc: '7很神奇', numbers: [7,14,21,28,35,42,49,56,63] },
    8: { title: '8的口诀', desc: '每次加8', numbers: [8,16,24,32,40,48,56,64,72] },
    9: { title: '9的口诀', desc: '数字和等于9', numbers: [9,18,27,36,45,54,63,72,81] }
  },

  // 初始化
  init() {
    this.loadProgress();
    this.setupBuilder();
    this.setupProgressRings();
    this.setupButtons();
    this.showCurrentRow();
  },

  // 加载进度
  loadProgress() {
    const saved = Storage.get('unlockedRows', [1]);
    this.unlockedRows = saved;
    this.currentRow = this.unlockedRows[this.unlockedRows.length - 1] || 1;
  },

  // 保存进度
  saveProgress() {
    Storage.set('unlockedRows', this.unlockedRows);
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

  // 添加数值到基地 - 每个基地只能放一个数字
  addValueToBase(base, value) {
    const baseValue = base.querySelector('.base-value');
    const currentValue = baseValue.textContent;

    // 如果基地已有值，不能放
    if (currentValue && currentValue !== '?') {
      this.showNotification('这个基地已经有数字了！', 'warning');
      return;
    }

    // 锁定数字
    if (this.lockedValue === null) {
      this.lockedValue = value;
      this.updateShelfLock();
    }

    // 设置基地值
    baseValue.textContent = value;
    baseValue.style.background = this.colors[value];
    baseValue.style.color = 'white';
    baseValue.classList.add('filled');
    base.classList.add('has-value');

    this.updateResult();
    this.createDropEffect(base);
  },

  // 更新结果显示 - 同时显示加法和乘法
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

    // 构建加法表达式
    const addParts = [];
    for (let i = 0; i < filledCount; i++) {
      addParts.push(`<span class="eq-num">${value}</span>`);
    }
    additionEl.innerHTML = addParts.join('<span class="eq-op">+</span>') +
      `<span class="eq-op">=</span><span class="eq-result">${filledCount * value}</span>`;

    // 检查是否构成乘法（2个以上相同数）
    if (filledCount >= 2) {
      const result = filledCount * value;
      multiplicationEl.style.display = 'block';
      multiplicationEl.className = 'result-multiplication';
      multiplicationEl.innerHTML = `
        <span class="eq-mul">${filledCount}×${value}=${result}</span>
        <span class="eq-chinese">${this.getChinesePhrase(filledCount, value)}</span>
      `;

      // 显示交换律按钮
      if (commutativeBtn && filledCount !== value) {
        commutativeBtn.style.display = 'inline-block';
        commutativeBtn.textContent = `转一转：${filledCount}×${value} = ${value}×${filledCount}`;
      } else if (commutativeBtn) {
        commutativeBtn.style.display = 'none';
      }

      // 检查挑战
      this.checkChallenge(result);

      // 检查是否所有基地都填满了
      if (filledCount === bases.length && bases.length >= 2) {
        this.showAllFilledCelebration();
      }
    } else if (filledCount === 1) {
      // 只有一个基地时，显示 1×N=N
      multiplicationEl.style.display = 'block';
      multiplicationEl.className = 'result-multiplication';
      multiplicationEl.innerHTML = `
        <span class="eq-mul">1×${value}=${value}</span>
        <span class="eq-chinese">${this.getChinesePhrase(1, value)}</span>
      `;
      chineseEl.textContent = '再放一个相同的数字，发现更多口诀！';
      if (commutativeBtn) commutativeBtn.style.display = 'none';

      // 第一个数字放入时的超人飞出效果
      this.showCelebration('太棒了！', '继续加油！');
    } else {
      multiplicationEl.style.display = 'none';
      chineseEl.textContent = '';
      if (commutativeBtn) commutativeBtn.style.display = 'none';
    }
  },

  // 获取中文口诀 - 结果<=10用"得"，>10直接拼接
  getChinesePhrase(a, b) {
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
    // 防止重复触发
    if (this._celebrating) return;
    this._celebrating = true;

    // 1. 烟花效果
    this.createFireworks();

    // 2. 超人飞过（只飞一次）
    setTimeout(() => {
      const hero = document.createElement('div');
      hero.className = 'flying-hero';
      hero.innerHTML = '<img src="ims.webp" class="flying-hero-img">';
      document.body.appendChild(hero);
      setTimeout(() => hero.remove(), 4000);
    }, 500);

    // 3. 鼓励弹窗（超人动画结束后出现）
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
        }, 300);
      });

      // 4秒后自动关闭
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

    // 创建多轮烟花
    for (let round = 0; round < 5; round++) {
      setTimeout(() => {
        const x = 10 + Math.random() * 80; // 随机位置 10%-90%
        const y = 10 + Math.random() * 40; // 上半部分

        for (let i = 0; i < 30; i++) {
          const particle = document.createElement('div');
          particle.className = 'firework-particle';
          particle.style.left = x + '%';
          particle.style.top = y + '%';

          // 随机方向和颜色
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

    // 清理
    setTimeout(() => container.remove(), 3000);
  },

  // 获取随机烟花颜色
  getRandomColor() {
    const colors = ['#FF6B6B', '#48dbfb', '#feca57', '#ff9ff3', '#00d2d3', '#54a0ff', '#ff9f43', '#a29bfe', '#fd79a8', '#FFD700', '#00FF88'];
    return colors[Math.floor(Math.random() * colors.length)];
  },

  // 所有基地填满庆祝
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
    }, 300);
  },

  // 更新基地布局 - 根据数量自适应为宫格
  updateBaseSizes() {
    const container = document.getElementById('basesContainer');
    if (!container) return;

    const count = container.children.length;

    // 根据基地数量设置宫格布局
    let columns;
    if (count === 1) columns = 1;
    else if (count <= 4) columns = 2;
    else columns = 3;

    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  },

  // 清空建造区
  clearBuilder() {
    document.querySelectorAll('.base-value').forEach(val => {
      val.textContent = '?';
      val.style.background = '';
      val.style.color = '';
      val.classList.remove('filled');
    });
    document.querySelectorAll('.base').forEach(base => {
      base.classList.remove('has-value');
    });

    // 解锁数字
    this.lockedValue = null;
    this.updateShelfLock();
    this._celebrating = false;

    document.getElementById('resultAddition').textContent = '';
    const mulEl = document.getElementById('resultMultiplication');
    mulEl.style.display = 'none';
    mulEl.textContent = '';
    mulEl.className = 'result-multiplication';
    document.getElementById('resultChinese').textContent = '';
    document.getElementById('btnCommutative').style.display = 'none';
  },

  // 开始挑战 - 显示难度选择
  startChallenge() {
    // 显示难度选择弹窗
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

    // 绑定按钮事件
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
    // 不同难度的目标数字
    const targetsByDifficulty = {
      easy: [4, 6, 8, 9, 10],      // 小数字，容易理解
      medium: [12, 15, 16, 18, 20], // 中等数字
      hard: [24, 27, 30, 36, 45]    // 大数字，需要更多思考
    };

    const targets = targetsByDifficulty[difficulty] || targetsByDifficulty.easy;
    this.challengeTarget = targets[Math.floor(Math.random() * targets.length)];

    const banner = document.getElementById('challengeBanner');
    const text = document.getElementById('challengeText');

    // 根据难度设置不同的提示文字
    const diffLabels = {
      easy: '🌟 容易：',
      medium: '🔥 中等：',
      hard: '⚡ 困难：'
    };

    text.textContent = `${diffLabels[difficulty]}拼出${this.challengeTarget}！`;
    banner.style.display = 'flex';

    // 根据目标计算合适的基地数量
    const baseCount = this.getChallengeBaseCount(this.challengeTarget);
    this.clearBuilder();
    this.initBases(baseCount);
    this.showNotification('开始挑战！', 'info');
  },

  // 根据挑战目标计算基地数量
  getChallengeBaseCount(target) {
    // 找到目标的所有因数（2-9之间）
    const factors = [];
    for (let i = 2; i <= 9; i++) {
      if (target % i === 0 && target / i <= 9) {
        factors.push(i);
      }
    }

    // 如果有因数，随机选一个作为基地数量
    if (factors.length > 0) {
      return factors[Math.floor(Math.random() * factors.length)];
    }

    // 如果没有合适的因数，返回默认值
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

    this.clearBuilder();
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

      this.updateResult();
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

  // 设置进度环
  setupProgressRings() {
    document.querySelectorAll('.ring-item').forEach(ring => {
      ring.addEventListener('click', () => {
        const row = parseInt(ring.dataset.row);
        if (this.unlockedRows.includes(row)) {
          this.selectRow(row);
        } else {
          this.showNotification(`先解锁 ${row} 的口诀！`, 'warning');
        }
      });
    });
    this.updateRings();
  },

  // 更新进度环
  updateRings() {
    document.querySelectorAll('.ring-item').forEach(ring => {
      const row = parseInt(ring.dataset.row);
      const circle = ring.querySelector('.ring-circle');
      const lock = ring.querySelector('.ring-lock');

      if (this.unlockedRows.includes(row)) {
        circle.classList.remove('locked');
        circle.classList.add('unlocked');
        if (lock) lock.style.display = 'none';
      } else {
        circle.classList.remove('unlocked');
        circle.classList.add('locked');
        if (lock) lock.style.display = 'block';
      }

      ring.classList.toggle('active', row === this.currentRow);
    });

    document.getElementById('unlockCount').textContent = this.unlockedRows.length;
  },

  // 选择行
  selectRow(row) {
    this.currentRow = row;
    this.updateRings();
    this.showCurrentRow();
  },

  // 显示当前行
  showCurrentRow() {
    document.getElementById('currentRowNum').textContent = this.currentRow;
    this.renderChant(this.currentRow);
  },

  // 渲染口诀节奏
  renderChant(row) {
    const chant = document.getElementById('rowChant');
    if (!chant) return;

    let html = '';
    for (let i = 1; i <= 9; i++) {
      const phrase = this.getChinesePhrase(row, i);
      html += `<span class="chant-word" style="animation-delay: ${(i - 1) * 0.15}s">${phrase}</span>`;
    }
    chant.innerHTML = html;
  },

  // 设置按钮
  setupButtons() {
    document.getElementById('btnPattern')?.addEventListener('click', () => this.showPattern());
    document.getElementById('btnQuiz')?.addEventListener('click', () => this.startQuiz());
    document.getElementById('closePattern')?.addEventListener('click', () => this.closePattern());
  },

  // 显示规律
  showPattern() {
    const row = this.currentRow;
    const pattern = this.patterns[row];
    if (!pattern) return;

    const section = document.getElementById('patternSection');
    const content = document.getElementById('patternContent');

    let html = `
      <h4>${pattern.title}</h4>
      <p>${pattern.desc}</p>
      <div class="pattern-numbers">
    `;

    pattern.numbers.forEach((num, i) => {
      html += `<span class="pattern-num" style="animation-delay: ${i * 0.1}s; background: ${this.colors[row]}">${num}</span>`;
      if (i < pattern.numbers.length - 1) {
        html += `<span class="pattern-plus">→</span>`;
      }
    });

    html += `</div>`;

    if (row === 2) html += `<p class="pattern-tip">都是偶数！</p>`;
    else if (row === 5) html += `<p class="pattern-tip">尾数是0或5！</p>`;
    else if (row === 9) html += `<p class="pattern-tip">数字和等于9！</p>`;

    content.innerHTML = html;
    section.style.display = 'block';
    section.style.animation = 'slideInUp 0.3s ease-out';
  },

  // 关闭规律
  closePattern() {
    document.getElementById('patternSection').style.display = 'none';
  },

  // 开始测验
  startQuiz() {
    const row = this.currentRow;
    const modal = document.getElementById('quizModal');
    if (!modal) return;

    this.quizRow = row;
    this.quizScore = 0;
    this.quizQuestionNum = 0;
    this.quizQuestions = this.generateQuizQuestions(row);

    modal.classList.add('active');
    this.showQuizQuestion();
  },

  // 生成测验题
  generateQuizQuestions(row) {
    const questions = [];
    const used = new Set();

    while (questions.length < 3) {
      const b = Math.floor(Math.random() * 9) + 1;
      const key = `${row}x${b}`;
      if (!used.has(key)) {
        used.add(key);
        questions.push({ a: row, b: b, answer: row * b, text: `${this.chineseNumbers[row]}${this.chineseNumbers[b]}得？` });
      }
    }
    return questions;
  },

  // 显示测验题
  showQuizQuestion() {
    const q = this.quizQuestions[this.quizQuestionNum];
    if (!q) return;

    document.getElementById('quizQuestion').textContent = q.text;
    document.getElementById('quizCurrent').textContent = this.quizQuestionNum + 1;
    document.getElementById('quizFeedback').textContent = '';

    const options = [q.answer];
    while (options.length < 4) {
      const wrong = q.answer + Math.floor(Math.random() * 10) - 5;
      if (wrong > 0 && wrong !== q.answer && !options.includes(wrong)) {
        options.push(wrong);
      }
    }
    this.shuffleArray(options);

    const optionsEl = document.getElementById('quizOptions');
    optionsEl.innerHTML = options.map(opt => `
      <button class="quiz-option" data-value="${opt}">${opt}</button>
    `).join('');

    optionsEl.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', () => this.checkQuizAnswer(parseInt(btn.dataset.value)));
    });
  },

  // 检查答案
  checkQuizAnswer(answer) {
    const q = this.quizQuestions[this.quizQuestionNum];
    const feedback = document.getElementById('quizFeedback');

    if (answer === q.answer) {
      this.quizScore++;
      feedback.textContent = '对了！';
      feedback.className = 'quiz-feedback correct';
    } else {
      feedback.textContent = `答案是 ${q.answer}`;
      feedback.className = 'quiz-feedback wrong';
    }

    document.querySelectorAll('.quiz-option').forEach(btn => {
      btn.disabled = true;
      if (parseInt(btn.dataset.value) === q.answer) {
        btn.classList.add('correct');
      }
    });

    setTimeout(() => {
      this.quizQuestionNum++;
      if (this.quizQuestionNum < 3) {
        this.showQuizQuestion();
      } else {
        this.endQuiz();
      }
    }, 1500);
  },

  // 结束测验
  endQuiz() {
    const modal = document.getElementById('quizModal');

    if (this.quizScore >= 2) {
      modal.classList.remove('active');
      this.unlockNextRow();
    } else {
      document.getElementById('quizFeedback').textContent = '再试一次！';
      document.getElementById('quizFeedback').className = 'quiz-feedback';
      setTimeout(() => modal.classList.remove('active'), 2000);
    }
  },

  // 解锁下一行
  unlockNextRow() {
    const nextRow = this.currentRow + 1;
    if (nextRow > 9) {
      this.showNotification('全都会了！太棒了！', 'success');
      return;
    }

    if (!this.unlockedRows.includes(nextRow)) {
      this.unlockedRows.push(nextRow);
      this.saveProgress();
      this.updateRings();
      this.showUnlockAnimation(nextRow);
    }
  },

  // 解锁动画
  showUnlockAnimation(row) {
    const modal = document.getElementById('unlockModal');
    const text = document.getElementById('unlockText');
    const chant = document.getElementById('unlockChant');

    text.textContent = `${row} 的口诀解锁了！`;
    chant.textContent = this.getChinesePhrase(row, 1);

    modal.classList.add('active');

    setTimeout(() => {
      modal.classList.remove('active');
      this.selectRow(row);
    }, 3000);
  },

  // 打乱数组
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  },

  // 显示通知
  showNotification(message, type = 'info') {
    if (typeof App !== 'undefined' && App.showNotification) {
      App.showNotification(message, type);
    }
  }
};
