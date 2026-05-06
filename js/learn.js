// learn.js - Animation teaching module
const Learn = {
  currentA: 3,
  currentB: 4,
  currentStep: 0,
  isPlaying: false,
  animationTimer: null,

  // Steps for the animation
  steps: [
    { name: 'intro', desc: '超人飞入' },
    { name: 'groups', desc: '召唤能量球' },
    { name: 'items', desc: '分裂小星星' },
    { name: 'count', desc: '数一数' },
    { name: 'result', desc: '显示结果' },
    { name: 'chinese', desc: '显示口诀' }
  ],

  // Initialize learn module
  init() {
    this.setupControls();
    this.resetStage();
  },

  // Setup control buttons
  setupControls() {
    const startBtn = document.getElementById('learnStart');
    const playBtn = document.getElementById('learnPlay');
    const prevBtn = document.getElementById('learnPrev');
    const nextBtn = document.getElementById('learnNext');
    const resetBtn = document.getElementById('learnReset');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.currentA = parseInt(document.getElementById('learnA').value);
        this.currentB = parseInt(document.getElementById('learnB').value);
        this.resetStage();
        this.playAnimation();
      });
    }

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (this.isPlaying) {
          this.pauseAnimation();
          playBtn.textContent = '继续';
        } else {
          this.playAnimation();
          playBtn.textContent = '暂停';
        }
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.prevStep();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.nextStep();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetStage();
        this.playAnimation();
      });
    }
  },

  // Reset the stage
  resetStage() {
    this.currentStep = 0;
    this.isPlaying = false;
    clearTimeout(this.animationTimer);

    const stage = document.getElementById('learnStage');
    const stageHero = document.getElementById('stageHero');
    const stageContent = document.getElementById('stageContent');
    const stageResult = document.getElementById('stageResult');
    const equation = document.getElementById('learnEquation');
    const chinese = document.getElementById('learnChinese');
    const stepInfo = document.getElementById('learnStep');

    if (stageHero) stageHero.innerHTML = '';
    if (stageContent) stageContent.innerHTML = '';
    if (stageResult) {
      stageResult.textContent = '';
      stageResult.style.opacity = '0';
      stageResult.style.transform = 'scale(0)';
    }
    if (equation) equation.textContent = `${this.currentA} × ${this.currentB} = ?`;
    if (chinese) chinese.textContent = '';
    if (stepInfo) stepInfo.textContent = '点击"播放"开始演示';

    const playBtn = document.getElementById('learnPlay');
    if (playBtn) playBtn.textContent = '播放';
  },

  // Play animation
  playAnimation() {
    this.isPlaying = true;
    this.executeStep(this.currentStep);

    const playBtn = document.getElementById('learnPlay');
    if (playBtn) playBtn.textContent = '暂停';
  },

  // Pause animation
  pauseAnimation() {
    this.isPlaying = false;
    clearTimeout(this.animationTimer);
  },

  // Go to next step
  nextStep() {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
      this.executeStep(this.currentStep);
    }
  },

  // Go to previous step
  prevStep() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.executeStep(this.currentStep);
    }
  },

  // Execute a specific step
  executeStep(stepIndex) {
    if (stepIndex >= this.steps.length) {
      this.isPlaying = false;
      return;
    }

    const step = this.steps[stepIndex];
    const stepInfo = document.getElementById('learnStep');
    if (stepInfo) stepInfo.textContent = `步骤 ${stepIndex + 1}: ${step.desc}`;

    switch (step.name) {
      case 'intro':
        this.animateIntro();
        break;
      case 'groups':
        this.animateGroups();
        break;
      case 'items':
        this.animateItems();
        break;
      case 'count':
        this.animateCount();
        break;
      case 'result':
        this.animateResult();
        break;
      case 'chinese':
        this.animateChinese();
        break;
    }
  },

  // Step 1: Hero flies in
  animateIntro() {
    const stageHero = document.getElementById('stageHero');
    if (!stageHero) return;

    stageHero.innerHTML = Hero.createHeroHTML({ size: 'normal' });
    stageHero.style.animation = 'heroFlyIn 0.8s ease-out forwards';

    this.animationTimer = setTimeout(() => {
      if (this.isPlaying) this.nextStep();
    }, 1200);
  },

  // Step 2: Summon energy balls (groups)
  animateGroups() {
    const stageContent = document.getElementById('stageContent');
    if (!stageContent) return;

    stageContent.innerHTML = '';

    for (let i = 0; i < this.currentA; i++) {
      const ball = document.createElement('div');
      ball.className = 'energy-ball';
      ball.style.opacity = '0';
      ball.style.transform = 'scale(0)';
      ball.textContent = i + 1;
      stageContent.appendChild(ball);

      setTimeout(() => {
        ball.style.transition = 'all 0.5s ease-out';
        ball.style.opacity = '1';
        ball.style.transform = 'scale(1)';
      }, i * 300);
    }

    this.animationTimer = setTimeout(() => {
      if (this.isPlaying) this.nextStep();
    }, this.currentA * 300 + 800);
  },

  // Step 3: Split into stars (items per group)
  animateItems() {
    const stageContent = document.getElementById('stageContent');
    if (!stageContent) return;

    stageContent.innerHTML = '';

    for (let i = 0; i < this.currentA; i++) {
      const group = document.createElement('div');
      group.className = 'visual-group';
      group.style.animation = `bounceIn 0.5s ease-out ${i * 0.2}s both`;

      for (let j = 0; j < this.currentB; j++) {
        const star = document.createElement('div');
        star.className = 'energy-star';
        star.textContent = '⭐';
        star.style.opacity = '0';
        star.style.transform = 'scale(0)';
        group.appendChild(star);

        setTimeout(() => {
          star.style.transition = 'all 0.3s ease-out';
          star.style.opacity = '1';
          star.style.transform = 'scale(1)';
        }, (i * this.currentB + j) * 100 + 500);
      }

      stageContent.appendChild(group);
    }

    const totalItems = this.currentA * this.currentB;
    this.animationTimer = setTimeout(() => {
      if (this.isPlaying) this.nextStep();
    }, totalItems * 100 + 1500);
  },

  // Step 4: Count animation
  animateCount() {
    const stageContent = document.getElementById('stageContent');
    if (!stageContent) return;

    const stars = stageContent.querySelectorAll('.energy-star');
    let count = 0;

    const countInterval = setInterval(() => {
      if (count < stars.length) {
        stars[count].style.filter = 'brightness(2)';
        stars[count].style.transform = 'scale(1.3)';

        const countDisplay = document.getElementById('learnEquation');
        if (countDisplay) {
          countDisplay.textContent = `${this.currentA} × ${this.currentB} = ${count + 1}`;
        }

        count++;
      } else {
        clearInterval(countInterval);
        this.animationTimer = setTimeout(() => {
          if (this.isPlaying) this.nextStep();
        }, 500);
      }
    }, 200);
  },

  // Step 5: Show result
  animateResult() {
    const stageResult = document.getElementById('stageResult');
    const equation = document.getElementById('learnEquation');

    if (stageResult) {
      stageResult.textContent = this.currentA * this.currentB;
      stageResult.style.transition = 'all 0.5s ease-out';
      stageResult.style.opacity = '1';
      stageResult.style.transform = 'scale(1)';
    }

    if (equation) {
      equation.textContent = `${this.currentA} × ${this.currentB} = ${this.currentA * this.currentB}`;
    }

    // Add fireworks effect
    this.createFireworks();

    this.animationTimer = setTimeout(() => {
      if (this.isPlaying) this.nextStep();
    }, 1500);
  },

  // Step 6: Show Chinese phrase
  animateChinese() {
    const chinese = document.getElementById('learnChinese');
    if (chinese) {
      const phrase = Table.getChinesePhrase(this.currentA, this.currentB);
      chinese.textContent = phrase;
      chinese.style.animation = 'bounceIn 0.5s ease-out';
    }

    // Hero celebrates
    const stageHero = document.getElementById('stageHero');
    if (stageHero) {
      Hero.celebrate(stageHero);
    }

    // Record learning
    Storage.recordActiveDay();
    Storage.updateMastery(this.currentA, this.currentB, true);
    Progress.checkAchievements();

    this.isPlaying = false;
    const playBtn = document.getElementById('learnPlay');
    if (playBtn) playBtn.textContent = '播放';
  },

  // Create fireworks effect
  createFireworks() {
    const stage = document.getElementById('learnStage');
    if (!stage) return;

    const colors = ['#FFD700', '#FF4444', '#1E90FF', '#00FF88', '#FF69B4'];

    for (let i = 0; i < 30; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.position = 'absolute';
      particle.style.left = '50%';
      particle.style.top = '30%';
      particle.style.width = '8px';
      particle.style.height = '8px';
      particle.style.borderRadius = '50%';
      particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      particle.style.setProperty('--tx', (Math.random() * 300 - 150) + 'px');
      particle.style.setProperty('--ty', (Math.random() * 200 - 150) + 'px');
      particle.style.animation = 'particleBurst 0.8s ease-out forwards';
      particle.style.animationDelay = (Math.random() * 0.3) + 's';

      stage.appendChild(particle);

      setTimeout(() => particle.remove(), 1500);
    }
  }
};
