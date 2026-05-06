// app.js - Main application logic
const App = {
  currentPage: 'home',

  // Initialize the application
  init() {
    this.createStarBackground();
    this.setupNavigation();
    this.initializeModules();
    this.showPage('home');

    // Record active day
    Storage.recordActiveDay();

    console.log('数学超人学院已启动！');
  },

  // Create animated star background
  createStarBackground() {
    const starsContainer = document.getElementById('stars');
    if (!starsContainer) return;

    const starCount = 100;
    for (let i = 0; i < starCount; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.style.left = Math.random() * 100 + '%';
      star.style.top = Math.random() * 100 + '%';
      star.style.setProperty('--duration', (2 + Math.random() * 3) + 's');
      star.style.animationDelay = Math.random() * 3 + 's';
      star.style.width = (1 + Math.random() * 2) + 'px';
      star.style.height = star.style.width;
      starsContainer.appendChild(star);
    }
  },

  // Setup navigation
  setupNavigation() {
    // Menu buttons on home page
    document.querySelectorAll('.menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        this.showPage(page);
      });
    });

    // Back buttons
    document.querySelectorAll('.back-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        this.showPage(page);
      });
    });

    // Game quit buttons
    document.querySelectorAll('.game-quit').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        Games.quitGame();
        this.showPage(page);
      });
    });
  },

  // Initialize all modules
  initializeModules() {
    Table.init();
    Learn.init();
    Games.init();
    Progress.init();
  },

  // Show a specific page
  showPage(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active');
    });

    // Show target page
    const targetPage = document.getElementById(`page-${pageId}`);
    if (targetPage) {
      targetPage.classList.add('active');
      this.currentPage = pageId;

      // Update page-specific content
      switch (pageId) {
        case 'home':
          Progress.updateStats();
          break;
        case 'builder':
          // 建造区初始化已在 Table.init() 中完成
          break;
        case 'table':
          Table.updateRings();
          Table.showCurrentRow();
          break;
        case 'achievements':
          Progress.renderAchievements();
          break;
      }

      // Scroll to top
      window.scrollTo(0, 0);
    }
  },

  // Show notification
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 15px 30px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      z-index: 3000;
      animation: slideInUp 0.3s ease-out;
      background: ${type === 'success' ? 'rgba(0, 255, 136, 0.9)' : type === 'error' ? 'rgba(255, 107, 107, 0.9)' : 'rgba(30, 144, 255, 0.9)'};
      color: white;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease-out forwards';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }
};

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
