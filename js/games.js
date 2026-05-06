// games.js - Three mini-games
const Games = {
  currentGame: null,
  score: 0,
  lives: 3,
  combo: 0,
  correct: 0,
  attempts: 0,

  // Initialize games module
  init() {
    this.setupGameSelection();
    this.setupQuitButtons();
  },

  // Setup game selection
  setupGameSelection() {
    // Balloon game difficulty buttons
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const difficulty = btn.dataset.diff;
        this.startGame('balloon', difficulty);
      });
    });

    // Star and cipher game start buttons
    document.querySelectorAll('.game-start-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startGame(btn.dataset.game);
      });
    });
  },

  // Setup quit buttons
  setupQuitButtons() {
    document.querySelectorAll('.game-quit').forEach(btn => {
      btn.addEventListener('click', () => {
        this.quitGame();
      });
    });
  },

  // Start a game
  startGame(game, difficulty = 'medium') {
    this.currentGame = game;
    this.score = 0;
    this.lives = 3;
    this.combo = 0;
    this.correct = 0;
    this.attempts = 0;

    // Hide games page, show game page
    document.getElementById('page-games').classList.remove('active');
    document.getElementById(`page-${game}`).classList.add('active');

    // Update displays
    this.updateScore(game);
    this.updateLives(game);

    // Initialize specific game
    switch (game) {
      case 'balloon':
        BalloonGame.init(difficulty);
        break;
      case 'star':
        StarGame.init();
        break;
      case 'cipher':
        CipherGame.init();
        break;
    }

    Storage.incrementGamePlayed(game);
  },

  // Quit current game
  quitGame() {
    if (this.currentGame) {
      document.getElementById(`page-${this.currentGame}`).classList.remove('active');
      document.getElementById('page-games').classList.add('active');

      // Clean up
      switch (this.currentGame) {
        case 'balloon':
          BalloonGame.cleanup();
          break;
        case 'star':
          StarGame.cleanup();
          break;
        case 'cipher':
          CipherGame.cleanup();
          break;
      }

      this.currentGame = null;
    }
  },

  // Update score display
  updateScore(game) {
    const scoreEl = document.getElementById(`${game}Score`);
    if (scoreEl) {
      scoreEl.textContent = this.score;
      scoreEl.style.animation = 'numberPop 0.3s ease-out';
      setTimeout(() => scoreEl.style.animation = '', 300);
    }
  },

  // Update lives display
  updateLives(game) {
    const livesEl = document.getElementById(`${game}Lives`);
    if (livesEl) {
      livesEl.textContent = '❤️'.repeat(this.lives) + '🖤'.repeat(3 - this.lives);
    }
  },

  // Generate a random question
  generateQuestion() {
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    return { a, b, answer: a * b, text: `${a} × ${b} = ?` };
  },

  // Generate wrong answers
  generateWrongAnswers(correctAnswer, count = 3) {
    const wrongs = new Set();
    while (wrongs.size < count) {
      let wrong;
      // Generate plausible wrong answers
      const offset = Math.floor(Math.random() * 5) + 1;
      if (Math.random() > 0.5) {
        wrong = correctAnswer + offset;
      } else {
        wrong = correctAnswer - offset;
      }
      // Ensure it's positive and different from correct
      if (wrong > 0 && wrong !== correctAnswer && wrong <= 81) {
        wrongs.add(wrong);
      }
    }
    return Array.from(wrongs);
  },

  // Handle correct answer
  onCorrect(game) {
    this.score += 10;
    this.correct++;
    this.attempts++;
    this.combo++;

    // Update streak
    Storage.updateStreak(true);

    // Add stars
    if (this.combo % 5 === 0) {
      Storage.addStars(5);
      this.showCombo(game);
    } else {
      Storage.addStars(1);
    }

    // Update displays
    this.updateScore(game);

    // Check achievements
    Progress.checkAchievements();

    return this.combo;
  },

  // Handle wrong answer
  onWrong(game) {
    this.lives--;
    this.attempts++;
    this.combo = 0;

    // Update streak
    Storage.updateStreak(false);

    // Update displays
    this.updateLives(game);

    return this.lives;
  },

  // Show combo effect
  showCombo(game) {
    const comboEl = document.getElementById(`${game}Combo`);
    if (comboEl) {
      comboEl.style.display = 'block';
      const countEl = document.getElementById('comboCount');
      if (countEl) countEl.textContent = this.combo;
      comboEl.style.animation = 'comboFlash 0.5s ease-out';
      setTimeout(() => comboEl.style.animation = '', 500);
    }
  },

  // Show game over
  showGameOver(game, won) {
    const modal = document.getElementById('gameOverModal');
    const title = document.getElementById('gameOverTitle');
    const score = document.getElementById('goScore');
    const accuracy = document.getElementById('goAccuracy');
    const stars = document.getElementById('goStars');

    if (title) title.textContent = won ? '任务完成！' : '任务失败！';
    if (score) score.textContent = this.score;
    if (accuracy) {
      const acc = this.attempts > 0 ? Math.round((this.correct / this.attempts) * 100) : 0;
      accuracy.textContent = acc + '%';
    }
    if (stars) stars.textContent = Math.floor(this.score / 10);

    modal.classList.add('active');

    // Setup buttons
    const retryBtn = document.getElementById('goRetry');
    const backBtn = document.getElementById('goBack');

    retryBtn.onclick = () => {
      modal.classList.remove('active');
      this.startGame(game);
    };

    backBtn.onclick = () => {
      modal.classList.remove('active');
      this.quitGame();
    };

    // Record learning
    Storage.recordActiveDay();
    Storage.addExp(this.score);
  },

  // Create particle explosion effect
  createParticles(x, y, color = '#FFD700') {
    const container = document.createElement('div');
    container.className = 'particles';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '1000';
    document.body.appendChild(container);

    for (let i = 0; i < 15; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.position = 'absolute';
      particle.style.left = x + 'px';
      particle.style.top = y + 'px';
      particle.style.width = '8px';
      particle.style.height = '8px';
      particle.style.borderRadius = '50%';
      particle.style.backgroundColor = color;
      particle.style.setProperty('--tx', (Math.random() * 150 - 75) + 'px');
      particle.style.setProperty('--ty', (Math.random() * 150 - 75) + 'px');
      particle.style.animation = 'particleBurst 0.6s ease-out forwards';
      container.appendChild(particle);
    }

    setTimeout(() => container.remove(), 1000);
  }
};

// ===== Balloon Game =====
const BalloonGame = {
  difficulty: 'medium',
  question: null,
  balloons: [],
  animationFrame: null,
  balloonInterval: null,

  init(difficulty = 'medium') {
    this.difficulty = difficulty;
    this.cleanup();
    this.newQuestion();
  },

  cleanup() {
    cancelAnimationFrame(this.animationFrame);
    clearInterval(this.balloonInterval);
    const container = document.getElementById('balloonsContainer');
    if (container) container.innerHTML = '';
    const area = document.getElementById('balloonArea');
    if (area) area.classList.remove('screen-shake');
  },

  newQuestion() {
    this.question = Games.generateQuestion();
    const questionEl = document.getElementById('balloonQuestion');
    if (questionEl) questionEl.textContent = this.question.text;

    // Generate balloon options
    const wrongAnswers = Games.generateWrongAnswers(this.question.answer,
      this.difficulty === 'easy' ? 1 : this.difficulty === 'medium' ? 3 : 5);
    const options = [this.question.answer, ...wrongAnswers];
    this.shuffleArray(options);

    this.spawnBalloons(options);
  },

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  },

  spawnBalloons(options) {
    const container = document.getElementById('balloonsContainer');
    if (!container) return;

    container.innerHTML = '';
    this.balloons = [];

    const containerRect = container.getBoundingClientRect();
    const balloonWidth = 70;
    const spacing = containerRect.width / (options.length + 1);

    options.forEach((value, index) => {
      const balloon = document.createElement('div');
      const colorClass = `balloon-${(index % 6) + 1}`;
      balloon.className = `balloon ${colorClass} floating`;
      balloon.textContent = value;
      balloon.dataset.value = value;

      // Position balloon
      const x = spacing * (index + 1) - balloonWidth / 2;
      const y = 50 + Math.random() * 100;
      balloon.style.left = x + 'px';
      balloon.style.top = y + 'px';
      balloon.style.animationDelay = (index * 0.2) + 's';

      // Click handler
      balloon.addEventListener('click', () => this.onBalloonClick(balloon, value));

      container.appendChild(balloon);
      this.balloons.push(balloon);
    });
  },

  onBalloonClick(balloon, value) {
    const rect = balloon.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    if (value === this.question.answer) {
      // Correct!
      balloon.classList.remove('floating');
      balloon.classList.add('popping');
      Games.createParticles(x, y, '#00FF88');

      // Hero celebrates
      const hero = document.getElementById('balloonHero');
      if (hero) Hero.celebrate(hero);

      setTimeout(() => {
        balloon.remove();
        Games.onCorrect('balloon');

        // Check for game over (win)
        if (Games.score >= 100) {
          Games.showGameOver('balloon', true);
        } else {
          setTimeout(() => this.newQuestion(), 500);
        }
      }, 400);
    } else {
      // Wrong!
      balloon.classList.remove('floating');
      balloon.classList.add('shrinking');
      Games.createParticles(x, y, '#FF6B6B');

      // Screen shake
      const area = document.getElementById('balloonArea');
      if (area) {
        area.classList.add('screen-shake');
        setTimeout(() => area.classList.remove('screen-shake'), 300);
      }

      const livesLeft = Games.onWrong('balloon');

      if (livesLeft <= 0) {
        setTimeout(() => Games.showGameOver('balloon', false), 500);
      }
    }
  }
};

// ===== Star Game =====
const StarGame = {
  question: null,
  collector: null,
  stars: [],
  animationFrame: null,
  starInterval: null,
  collectorX: 0,
  gameWidth: 0,
  gameHeight: 0,
  speed: 2,

  init() {
    this.cleanup();
    this.setupControls();
    this.newQuestion();

    const area = document.getElementById('starArea');
    if (area) {
      this.gameWidth = area.offsetWidth;
      this.gameHeight = area.offsetHeight;
      this.collectorX = this.gameWidth / 2 - 40;
    }

    this.collector = document.getElementById('starCollector');
    if (this.collector) {
      this.collector.style.left = this.collectorX + 'px';
    }

    this.startSpawning();
    this.startGameLoop();
  },

  cleanup() {
    cancelAnimationFrame(this.animationFrame);
    clearInterval(this.starInterval);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('mousemove', this.handleMouseMove);

    const container = document.getElementById('starsContainer');
    if (container) container.innerHTML = '';
  },

  setupControls() {
    this.handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') {
        this.moveCollector(-20);
      } else if (e.key === 'ArrowRight') {
        this.moveCollector(20);
      }
    };

    this.handleMouseMove = (e) => {
      const area = document.getElementById('starArea');
      if (area) {
        const rect = area.getBoundingClientRect();
        this.collectorX = e.clientX - rect.left - 40;
        this.collectorX = Math.max(0, Math.min(this.gameWidth - 80, this.collectorX));
        if (this.collector) {
          this.collector.style.left = this.collectorX + 'px';
        }
      }
    };

    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('mousemove', this.handleMouseMove);
  },

  moveCollector(dx) {
    this.collectorX += dx;
    this.collectorX = Math.max(0, Math.min(this.gameWidth - 80, this.collectorX));
    if (this.collector) {
      this.collector.style.left = this.collectorX + 'px';
    }
  },

  newQuestion() {
    this.question = Games.generateQuestion();
    const questionEl = document.getElementById('starQuestion');
    if (questionEl) questionEl.textContent = this.question.text;
  },

  startSpawning() {
    const interval = this.difficulty === 'easy' ? 2000 : this.difficulty === 'medium' ? 1500 : 1000;

    this.starInterval = setInterval(() => {
      this.spawnStar();
    }, interval);
  },

  spawnStar() {
    const container = document.getElementById('starsContainer');
    if (!container) return;

    const isCorrect = Math.random() < 0.4; // 40% chance of correct answer
    let value;

    if (isCorrect) {
      value = this.question.answer;
    } else {
      const wrongs = Games.generateWrongAnswers(this.question.answer, 5);
      value = wrongs[Math.floor(Math.random() * wrongs.length)];
    }

    const star = document.createElement('div');
    star.className = 'falling-star';
    star.textContent = value;
    star.dataset.value = value;
    star.dataset.correct = isCorrect ? 'true' : 'false';

    const x = Math.random() * (this.gameWidth - 50);
    star.style.left = x + 'px';
    star.style.top = '-50px';

    container.appendChild(star);
    this.stars.push(star);
  },

  startGameLoop() {
    const loop = () => {
      this.stars.forEach((star, index) => {
        const top = parseFloat(star.style.top) || 0;
        star.style.top = (top + this.speed) + 'px';

        // Check collision with collector
        if (this.collector) {
          const starRect = star.getBoundingClientRect();
          const collectorRect = this.collector.getBoundingClientRect();

          if (this.checkCollision(starRect, collectorRect)) {
            this.collectStar(star);
            return;
          }
        }

        // Remove if off screen
        if (top > this.gameHeight) {
          this.missStar(star);
        }
      });

      // Clean up removed stars
      this.stars = this.stars.filter(s => s.parentNode);

      this.animationFrame = requestAnimationFrame(loop);
    };

    loop();
  },

  checkCollision(rect1, rect2) {
    return !(rect1.right < rect2.left ||
             rect1.left > rect2.right ||
             rect1.bottom < rect2.top ||
             rect1.top > rect2.bottom);
  },

  collectStar(star) {
    const value = parseInt(star.dataset.value);
    const isCorrect = value === this.question.answer;

    const rect = star.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    if (isCorrect) {
      // Correct!
      star.style.animation = 'starCollect 0.4s ease-out forwards';
      Games.createParticles(x, y, '#FFD700');

      const combo = Games.onCorrect('star');

      // Update combo display
      const comboEl = document.getElementById('starCombo');
      const comboCount = document.getElementById('comboCount');
      if (comboEl && comboCount && combo >= 3) {
        comboEl.style.display = 'block';
        comboCount.textContent = combo;
      }

      setTimeout(() => star.remove(), 400);

      // New question after a few correct answers
      if (Games.correct % 3 === 0) {
        setTimeout(() => this.newQuestion(), 500);
      }
    } else {
      // Wrong answer collected
      star.style.animation = 'starCollect 0.4s ease-out forwards';
      Games.createParticles(x, y, '#FF6B6B');

      const livesLeft = Games.onWrong('star');
      setTimeout(() => star.remove(), 400);

      if (livesLeft <= 0) {
        Games.showGameOver('star', false);
      }
    }
  },

  missStar(star) {
    const value = parseInt(star.dataset.value);
    if (value === this.question.answer) {
      // Missed a correct answer
      const livesLeft = Games.onWrong('star');
      if (livesLeft <= 0) {
        Games.showGameOver('star', false);
      }
    }
    star.remove();
  }
};

// ===== Cipher Game =====
const CipherGame = {
  question: null,
  mode: 'forward', // forward, reverse, challenge
  currentInput: '',
  progress: 0,
  totalQuestions: 10,
  timer: null,
  timeLeft: 0,

  init() {
    this.cleanup();
    this.progress = 0;
    this.newQuestion();
    this.setupKeypad();
  },

  cleanup() {
    clearInterval(this.timer);
    this.currentInput = '';
  },

  setupKeypad() {
    const keypad = document.getElementById('cipherKeypad');
    if (!keypad) return;

    keypad.querySelectorAll('.key-btn').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.key;
        this.onKeyPress(key);
      };
    });
  },

  onKeyPress(key) {
    if (key === 'clear') {
      this.currentInput = '';
      this.updateDisplay();
    } else if (key === 'enter') {
      this.submitAnswer();
    } else {
      if (this.currentInput.length < 2) {
        this.currentInput += key;
        this.updateDisplay();
      }
    }
  },

  updateDisplay() {
    const display = document.getElementById('cipherDisplay');
    if (!display) return;

    if (this.mode === 'forward') {
      const parts = this.question.text.split(' = ');
      display.textContent = `${parts[0]} = ${this.currentInput || '____'}`;
    } else {
      display.textContent = this.currentInput || '____';
    }
  },

  newQuestion() {
    this.question = Games.generateQuestion();
    this.currentInput = '';

    const display = document.getElementById('cipherDisplay');
    const hint = document.getElementById('cipherHint');
    const progress = document.getElementById('cipherProgress');

    if (display) {
      if (this.mode === 'forward') {
        display.textContent = `${this.question.a} × ${this.question.b} = ____`;
      } else {
        display.textContent = `____ × ____ = ${this.question.answer}`;
      }
    }

    if (hint) hint.textContent = '输入正确答案解锁';
    if (progress) progress.textContent = this.progress;
  },

  submitAnswer() {
    if (!this.currentInput) return;

    const answer = parseInt(this.currentInput);
    const lock = document.querySelector('.lock-body');
    const result = document.getElementById('cipherResult');

    if (answer === this.question.answer) {
      // Correct!
      if (lock) {
        lock.classList.add('unlocking');
        setTimeout(() => lock.classList.remove('unlocking'), 800);
      }

      if (result) {
        result.innerHTML = '<div class="result-message correct">密码正确！锁已打开！</div>';
      }

      Games.onCorrect('cipher');
      this.progress++;

      // Record mastery
      Storage.updateMastery(this.question.a, this.question.b, true);

      setTimeout(() => {
        if (this.progress >= this.totalQuestions) {
          Games.showGameOver('cipher', true);
        } else {
          this.newQuestion();
          if (result) result.innerHTML = '';
        }
      }, 1500);
    } else {
      // Wrong!
      if (lock) {
        lock.classList.add('shaking');
        setTimeout(() => lock.classList.remove('shaking'), 500);
      }

      if (result) {
        result.innerHTML = `<div class="result-message wrong">答案错误！正确答案是 ${this.question.answer}</div>`;
      }

      Games.onWrong('cipher');

      if (Games.lives <= 0) {
        setTimeout(() => Games.showGameOver('cipher', false), 1000);
      } else {
        setTimeout(() => {
          this.newQuestion();
          if (result) result.innerHTML = '';
        }, 2000);
      }
    }

    this.currentInput = '';
  }
};
