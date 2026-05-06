// app.js - Application entry point
const App = {
  init() {
    this.createStarBackground();
    Table.init();
    console.log('动手建造区已启动！');
  },

  createStarBackground() {
    const starsContainer = document.getElementById('stars');
    if (!starsContainer) return;
    for (let i = 0; i < 100; i++) {
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

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
