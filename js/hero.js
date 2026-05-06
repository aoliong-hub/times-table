// hero.js - Superhero character system
const Hero = {
  // Hero states
  states: {
    IDLE: 'idle',
    FLYING: 'flying',
    THINKING: 'thinking',
    CELEBRATING: 'celebrating',
    ATTACKING: 'attacking',
    HURT: 'hurt'
  },

  currentState: 'idle',

  // Create hero HTML
  createHeroHTML(options = {}) {
    const { size = 'normal', showCape = true, showCrown = false, equipped = false } = options;

    const sizeClass = size === 'small' ? 'hero-small' : size === 'large' ? 'hero-large' : '';
    const equippedClass = equipped ? 'equipped' : '';

    return `
      <div class="hero-body ${sizeClass} ${equippedClass}">
        <div class="hero-head">
          <div class="hero-eyes"></div>
          <div class="hero-smile"></div>
        </div>
        <div class="hero-torso">
          <div class="hero-emblem">x</div>
        </div>
        ${showCape ? '<div class="hero-cape"></div>' : ''}
        ${showCrown ? '<div class="hero-crown"></div>' : ''}
        <div class="hero-arm left"></div>
        <div class="hero-arm right"></div>
      </div>
    `;
  },

  // Set hero state
  setState(heroElement, state) {
    if (!heroElement) return;

    // Remove all state classes
    heroElement.classList.remove('state-idle', 'state-flying', 'state-thinking',
      'state-celebrating', 'state-attacking', 'state-hurt');

    // Add new state class
    heroElement.classList.add(`state-${state}`);
    this.currentState = state;

    // Add corresponding animation
    const body = heroElement.querySelector('.hero-body');
    if (body) {
      body.style.animation = '';
      switch (state) {
        case this.states.FLYING:
          body.style.animation = 'heroFlyIn 0.8s ease-out forwards';
          break;
        case this.states.CELEBRATING:
          body.style.animation = 'heroCelebrate 0.8s ease-in-out';
          break;
        case this.states.ATTACKING:
          body.style.animation = 'heroAttack 0.4s ease-out';
          break;
        case this.states.HURT:
          body.style.animation = 'shake 0.3s ease-in-out';
          break;
        case this.states.THINKING:
          body.style.animation = 'heroFloat 2s ease-in-out infinite';
          break;
        default:
          body.style.animation = 'heroFloat 3s ease-in-out infinite';
      }
    }
  },

  // Fly hero to a position
  flyTo(heroElement, x, y, duration = 500) {
    if (!heroElement) return Promise.resolve();

    return new Promise(resolve => {
      heroElement.style.transition = `all ${duration}ms ease-out`;
      heroElement.style.position = 'absolute';
      heroElement.style.left = x + 'px';
      heroElement.style.top = y + 'px';

      setTimeout(() => {
        heroElement.style.transition = '';
        resolve();
      }, duration);
    });
  },

  // Show hero attacking (shoot beam)
  attack(heroElement, targetElement) {
    if (!heroElement || !targetElement) return Promise.resolve();

    return new Promise(resolve => {
      this.setState(heroElement, this.states.ATTACKING);

      // Create beam effect
      const beam = document.createElement('div');
      beam.className = 'hero-beam active';
      beam.style.position = 'absolute';

      const heroRect = heroElement.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();

      beam.style.left = (heroRect.left + heroRect.width / 2) + 'px';
      beam.style.top = heroRect.top + 'px';
      beam.style.width = '4px';
      beam.style.height = Math.abs(targetRect.top - heroRect.top) + 'px';
      beam.style.background = 'linear-gradient(180deg, transparent, rgba(30, 144, 255, 0.8))';

      document.body.appendChild(beam);

      setTimeout(() => {
        beam.remove();
        resolve();
      }, 400);
    });
  },

  // Show celebration
  celebrate(heroElement) {
    if (!heroElement) return;

    this.setState(heroElement, this.states.CELEBRATING);

    // Create confetti
    this.createConfetti(heroElement);

    setTimeout(() => {
      this.setState(heroElement, this.states.IDLE);
    }, 1500);
  },

  // Create confetti effect
  createConfetti(sourceElement) {
    const rect = sourceElement.getBoundingClientRect();
    const colors = ['#FFD700', '#FF4444', '#1E90FF', '#00FF88', '#FF69B4'];

    for (let i = 0; i < 20; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti-piece';
      confetti.style.left = (rect.left + rect.width / 2) + 'px';
      confetti.style.top = rect.top + 'px';
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.setProperty('--duration', (0.5 + Math.random() * 1) + 's');
      confetti.style.setProperty('--rotation', (360 + Math.random() * 720) + 'deg');
      confetti.style.setProperty('--tx', (Math.random() * 200 - 100) + 'px');

      document.body.appendChild(confetti);

      setTimeout(() => confetti.remove(), 2000);
    }
  },

  // Show hurt state
  hurt(heroElement) {
    if (!heroElement) return;

    this.setState(heroElement, this.states.HURT);
    heroElement.style.filter = 'brightness(2)';

    setTimeout(() => {
      heroElement.style.filter = '';
      this.setState(heroElement, this.states.IDLE);
    }, 500);
  },

  // Get equipped state based on level
  getEquippedState() {
    const level = Storage.get('level', 1);
    const mastery = Storage.getTotalMastery();

    if (mastery >= 90) return { equipped: true, gold: true, crown: true };
    if (mastery >= 60) return { equipped: true, gold: false, crown: false };
    if (mastery >= 30) return { equipped: true, gold: false, crown: false };
    return { equipped: false, gold: false, crown: false };
  },

  // Update hero appearance based on progress
  updateAppearance(heroElement) {
    if (!heroElement) return;

    const state = this.getEquippedState();
    const body = heroElement.querySelector('.hero-body');

    if (body) {
      body.classList.toggle('equipped', state.equipped);
      body.classList.toggle('gold', state.gold);

      const crown = heroElement.querySelector('.hero-crown');
      if (crown) {
        crown.style.display = state.crown ? 'block' : 'none';
      }

      const cape = heroElement.querySelector('.hero-cape');
      if (cape) {
        if (state.gold) {
          cape.style.background = 'linear-gradient(180deg, #FFD700, #ff8c00)';
        } else if (state.equipped) {
          cape.style.background = 'linear-gradient(180deg, #C0C0C0, #A0A0A0)';
        }
      }
    }
  },

  // Create mini hero for game UI
  createMiniHero() {
    return `
      <div class="hero-mini">
        <div class="hero-body" style="transform: scale(0.5);">
          <div class="hero-head">
            <div class="hero-eyes"></div>
            <div class="hero-smile"></div>
          </div>
          <div class="hero-torso">
            <div class="hero-emblem">x</div>
          </div>
          <div class="hero-cape"></div>
        </div>
      </div>
    `;
  }
};
