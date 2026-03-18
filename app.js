// ===================== STATE =====================
let state = {
  user: null,
  balance: 0,
  invested: 0,
  profits: 0,
  withdrawn: 0,
  investments: [],
  transactions: [],
  referrals: [],
  referralEarnings: 0,
  activeTab: 'overview'
};

const PLANS = [
  { id: 1, name: 'Starter', roi: 3, period: 7, min: 100, max: 999, color: '#4d9fff', duration: '7 Days', features: ['3% Daily ROI', 'Min $100 deposit', '7 Day contract', 'Instant withdrawal', 'Email support'] },
  { id: 2, name: 'Silver', roi: 5, period: 14, min: 1000, max: 4999, color: '#b0b0b0', duration: '14 Days', features: ['5% Daily ROI', 'Min $1,000 deposit', '14 Day contract', 'Instant withdrawal', 'Priority support'], featured: false },
  { id: 3, name: 'Gold', roi: 7, period: 21, min: 5000, max: 19999, color: '#f0b429', duration: '21 Days', features: ['7% Daily ROI', 'Min $5,000 deposit', '21 Day contract', 'Instant withdrawal', 'VIP support'], featured: true },
  { id: 4, name: 'Platinum', roi: 10, period: 30, min: 20000, max: 999999, color: '#7c6af7', duration: '30 Days', features: ['10% Daily ROI', 'Min $20,000 deposit', '30 Day contract', 'Instant withdrawal', 'Dedicated manager'] }
];

const MARKETS = [
  { icon: '₿', name: 'Bitcoin', sym: 'BTC', price: 67420.50, change: 2.4, volume: '28.5B' },
  { icon: 'Ξ', name: 'Ethereum', sym: 'ETH', price: 3210.80, change: 1.8, volume: '14.2B' },
  { icon: '◎', name: 'Solana', sym: 'SOL', price: 182.40, change: -0.9, volume: '4.1B' },
  { icon: '●', name: 'BNB', sym: 'BNB', price: 540.20, change: 3.1, volume: '2.8B' },
  { icon: '◈', name: 'USDT', sym: 'USDT', price: 1.00, change: 0.01, volume: '52.1B' },
  { icon: '✦', name: 'XRP', sym: 'XRP', price: 0.62, change: -1.3, volume: '3.2B' },
];

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => {
  renderPlans();
  renderMarkets();
  renderTicker();
  animateStats();
  setupScrollNav();
  checkAutoLogin();
  setInterval(updateMarketPrices, 5000);
  setInterval(updateTicker, 5000);
});

// ===================== NAV =====================
function setupScrollNav() {
  window.addEventListener('scroll', () => {
    const nav = document.getElementById('navbar');
    if (window.scrollY > 50) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  });
}
function toggleMenu() {
  document.getElementById('navLinks').classList.toggle('open');
}
function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

// ===================== HERO CHART =====================
function drawMiniChart() {
  const canvas = document.getElementById('miniChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const points = [20, 45, 35, 60, 50, 75, 65, 85, 70, 90, 80, 95];
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(240,180,41,0.3)');
  grad.addColorStop(1, 'rgba(240,180,41,0)');
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - (p / 100) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#f0b429';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}
setTimeout(drawMiniChart, 100);

// ===================== TICKER =====================
function renderTicker() {
  const ticker = document.getElementById('ticker');
  const items = [...MARKETS, ...MARKETS].map(m => {
    const up = m.change >= 0;
    return `<div class="ticker-item"><span class="ticker-sym">${m.sym}</span><span class="ticker-price">$${m.price.toLocaleString()}</span><span class="ticker-chg ${up ? 'up' : 'down'}">${up ? '+' : ''}${m.change}%</span></div>`;
  }).join('');
  ticker.innerHTML = items;
}
function updateTicker() {
  MARKETS.forEach(m => {
    m.price = +(m.price * (1 + (Math.random() - 0.48) * 0.002)).toFixed(m.price > 100 ? 2 : 4);
    m.change = +(m.change + (Math.random() - 0.5) * 0.1).toFixed(2);
  });
  renderTicker();
}

// ===================== PLANS =====================
function renderPlans() {
  const grid = document.getElementById('plansGrid');
  if (!grid) return;
  grid.innerHTML = PLANS.map(p => `
    <div class="plan-card ${p.featured ? 'featured' : ''}" style="--plan-color:${p.color}">
      ${p.featured ? '<div class="plan-badge">POPULAR</div>' : ''}
      <div class="plan-name">${p.name}</div>
      <div class="plan-roi">${p.roi}%</div>
      <div class="plan-roi-label">Daily ROI • ${p.duration}</div>
      <ul class="plan-features">${p.features.map(f => `<li>${f}</li>`).join('')}</ul>
      <button class="plan-invest-btn" onclick="selectPlan(${p.id})">Invest Now</button>
    </div>
  `).join('');
}

function selectPlan(planId) {
  if (!state.user) { showModal('register'); return; }
  showTab('invest');
  document.getElementById('dashboardOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(() => renderInvestTab(planId), 100);
}

// ===================== MARKETS =====================
function renderMarkets() {
  const tbody = document.getElementById('marketTbody');
  if (!tbody) return;
  tbody.innerHTML = MARKETS.map(m => {
    const up = m.change >= 0;
    return `<tr>
      <td><div class="asset-info"><div class="asset-icon">${m.icon}</div><div><div class="asset-name">${m.name}</div><div class="asset-sym">${m.sym}</div></div></div></td>
      <td><strong>$${m.price.toLocaleString()}</strong></td>
      <td class="${up ? 'chg-up' : 'chg-down'}">${up ? '+' : ''}${m.change}%</td>
      <td>$${m.volume}</td>
      <td><svg class="mini-bar" viewBox="0 0 80 30">${generateSparkline(up)}</svg></td>
    </tr>`;
  }).join('');
}
function generateSparkline(up) {
  const pts = Array.from({length: 10}, () => Math.random() * 20 + 5);
  if (up) pts[pts.length-1] = Math.max(...pts);
  else pts[pts.length-1] = Math.min(...pts);
  const path = pts.map((y, i) => `${i * 9},${30 - y}`).join(' ');
  const color = up ? '#00e676' : '#ff4d6a';
  return `<polyline points="${path}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
}
function updateMarketPrices() {
  MARKETS.forEach(m => {
    m.price = +(m.price * (1 + (Math.random() - 0.49) * 0.003)).toFixed(m.price > 100 ? 2 : 4);
    m.change = +(m.change + (Math.random() - 0.5) * 0.2).toFixed(2);
  });
  renderMarkets();
}

// ===================== ANIMATE STATS =====================
function animateStats() {
  document.querySelectorAll('.stat-num').forEach(el => {
    const target = parseInt(el.dataset.target);
    let current = 0;
    const step = target / 60;
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = Math.floor(current).toLocaleString();
      if (current >= target) clearInterval(timer);
    }, 20);
  });
}

// ===================== AUTH =====================
function checkAutoLogin() {
  const saved = localStorage.getItem('luminavest_user');
  if (saved) {
    state.user = JSON.parse(saved);
    loadUserData();
  }
}

function showModal(type) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  overlay.classList.add('active');
  if (type === 'login') {
    content.innerHTML = `
      <div class="modal-title">Welcome Back</div>
      <div class="modal-sub">Log in to your LuminaVest account</div>
      <div class="form-group"><label>Email Address</label><input class="form-control" id="loginEmail" type="email" placeholder="you@example.com"></div>
      <div class="form-group"><label>Password</label><input class="form-control" id="loginPass" type="password" placeholder="••••••••"></div>
      <button class="btn-primary btn-full" onclick="login()">Login to Account</button>
      <div class="modal-switch">Don't have an account? <span onclick="showModal('register')">Register here</span></div>
      <div class="modal-switch" style="margin-top:8px"><span onclick="showModal('forgot')">Forgot password?</span></div>`;
  } else if (type === 'register') {
    content.innerHTML = `
      <div class="modal-title">Create Account</div>
      <div class="modal-sub">Start investing in under 2 minutes</div>
      <div class="form-row">
        <div class="form-group"><label>First Name</label><input class="form-control" id="regFirst" placeholder="John"></div>
        <div class="form-group"><label>Last Name</label><input class="form-control" id="regLast" placeholder="Doe"></div>
      </div>
      <div class="form-group"><label>Email Address</label><input class="form-control" id="regEmail" type="email" placeholder="you@example.com"></div>
      <div class="form-group"><label>Phone Number</label><input class="form-control" id="regPhone" type="tel" placeholder="+254 700 000000"></div>
      <div class="form-group"><label>Password</label><input class="form-control" id="regPass" type="password" placeholder="Min 8 characters"></div>
      <div class="form-group"><label>Referral Code (optional)</label><input class="form-control" id="regRef" placeholder="Enter referral code"></div>
      <button class="btn-primary btn-full" onclick="register()">Create My Account</button>
      <div class="modal-switch">Already have an account? <span onclick="showModal('login')">Login here</span></div>`;
  } else if (type === 'forgot') {
    content.innerHTML = `
      <div class="modal-title">Reset Password</div>
      <div class="modal-sub">Enter your email to receive reset instructions</div>
      <div class="form-group"><label>Email Address</label><input class="form-control" id="forgotEmail" type="email" placeholder="you@example.com"></div>
      <button class="btn-primary btn-full" onclick="forgotPassword()">Send Reset Link</button>
      <div class="modal-switch"><span onclick="showModal('login')">← Back to Login</span></div>`;
  }
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.remove('active');
}

function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const users = JSON.parse(localStorage.getItem('luminavest_users') || '[]');
  const user = users.find(u => u.email === email && u.password === pass);
  if (!user) { showToast('Invalid email or password', 'error'); return; }
  state.user = user;
  localStorage.setItem('luminavest_user', JSON.stringify(user));
  loadUserData();
  closeModalDirect();
  openDashboard();
  showToast('Welcome back, ' + user.firstName + '! 👋', 'success');
}

function register() {
  const first = document.getElementById('regFirst').value.trim();
  const last = document.getElementById('regLast').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const pass = document.getElementById('regPass').value;
  const ref = document.getElementById('regRef').value.trim();
  if (!first || !last || !email || !pass) { showToast('Please fill all required fields', 'error'); return; }
  if (pass.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
  const users = JSON.parse(localStorage.getItem('luminavest_users') || '[]');
  if (users.find(u => u.email === email)) { showToast('Email already registered', 'error'); return; }
  const newUser = { id: Date.now(), firstName: first, lastName: last, email, phone, password: pass, refCode: 'LV' + Math.random().toString(36).substring(2,8).toUpperCase(), joinDate: new Date().toISOString() };
  users.push(newUser);
  localStorage.setItem('luminavest_users', JSON.stringify(users));
  state.user = newUser;
  localStorage.setItem('luminavest_user', JSON.stringify(newUser));
  loadUserData();
  closeModalDirect();
  openDashboard();
  showToast('Account created! Welcome to LuminaVest 🎉', 'success');
}

function forgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) { showToast('Please enter your email', 'error'); return; }
  showToast('Reset instructions sent to ' + email, 'success');
  setTimeout(() => showModal('login'), 1500);
}

function logout() {
  state.user = null;
  localStorage.removeItem('luminavest_user');
  document.getElementById('dashboardOverlay').classList.remove('active');
  document.body.style.overflow = '';
  showToast('Logged out successfully', 'success');
}

// ===================== DASHBOARD =====================
function openDashboard() {
  document.getElementById('dashboardOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  document.getElementById('dashUserName').textContent = state.user.firstName + ' ' + state.user.lastName;
  showTab('overview');
}

function loadUserData() {
  const key = 'lv_data_' + state.user.id;
  const saved = JSON.parse(localStorage.getItem(key) || 'null');
  if (saved) {
    state.balance = saved.balance || 0;
    state.invested = saved.invested || 0;
    state.profits = saved.profits || 0;
    state.withdrawn = saved.withdrawn || 0;
    state.investments = saved.investments || [];
    state.transactions = saved.transactions || [];
    state.referrals = saved.referrals || [];
    state.referralEarnings = saved.referralEarnings || 0;
    simulateProfits();
  } else {
    state.balance = 0; state.invested = 0; state.profits = 0;
    state.withdrawn = 0; state.investments = []; state.transactions = [];
    state.referrals = []; state.referralEarnings = 0;
  }
}

function saveUserData() {
  const key = 'lv_data_' + state.user.id;
  localStorage.setItem(key, JSON.stringify({
    balance: state.balance, invested: state.invested, profits: state.profits,
    withdrawn: state.withdrawn, investments: state.investments,
    transactions: state.transactions, referrals: state.referrals,
    referralEarnings: state.referralEarnings
  }));
}

function simulateProfits() {
  const now = Date.now();
  state.investments = state.investments.map(inv => {
    if (inv.status !== 'active') return inv;
    const plan = PLANS.find(p => p.id === inv.planId);
    const hoursElapsed = (now - inv.startTime) / (1000 * 60 * 60);
    const daysElapsed = Math.min(hoursElapsed / 24, plan.period);
    const earned = inv.amount * (plan.roi / 100) * daysElapsed;
    inv.earned = earned;
    if (daysElapsed >= plan.period) {
      inv.status = 'completed';
      state.balance += inv.amount + earned - (inv.credited || 0);
      state.profits += earned - (inv.credited || 0);
      inv.credited = earned;
      addTransaction('profit', inv.amount + earned, 'Investment #' + inv.id + ' completed', 'success');
    }
    return inv;
  });
  saveUserData();
}

function showTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.dash-item').forEach((el, i) => {
    const tabs = ['overview','invest','deposit','withdraw','history','referral','profile'];
    el.classList.toggle('active', tabs[i] === tab);
  });
  const main = document.getElementById('dashMain');
  switch(tab) {
    case 'overview': main.innerHTML = renderOverview(); drawDashChart(); break;
    case 'invest': main.innerHTML = renderInvestTab(); break;
    case 'deposit': main.innerHTML = renderDeposit(); break;
    case 'withdraw': main.innerHTML = renderWithdraw(); break;
    case 'history': main.innerHTML = renderHistory(); break;
    case 'referral': main.innerHTML = renderReferral(); break;
    case 'profile': main.innerHTML = renderProfile(); break;
  }
}

// ===================== OVERVIEW =====================
function renderOverview() {
  const totalPortfolio = state.balance + state.invested;
  const activeInvs = state.investments.filter(i => i.status === 'active');
  return `
    <div class="dash-title">Portfolio Overview</div>
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-card-label">Available Balance</div>
        <div class="stat-card-val">$${state.balance.toFixed(2)}</div>
        <div class="stat-card-change up">Ready to invest or withdraw</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Total Invested</div>
        <div class="stat-card-val">$${state.invested.toFixed(2)}</div>
        <div class="stat-card-change">${activeInvs.length} active plan(s)</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Total Profits</div>
        <div class="stat-card-val" style="color:var(--green)">$${state.profits.toFixed(2)}</div>
        <div class="stat-card-change up">↑ Earning daily</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Total Withdrawn</div>
        <div class="stat-card-val">$${state.withdrawn.toFixed(2)}</div>
        <div class="stat-card-change">Paid out successfully</div>
      </div>
    </div>
    <div class="two-col">
      <div>
        <h3 style="margin-bottom:16px;font-family:'Syne',sans-serif">Portfolio Chart</h3>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px">
          <canvas id="dashChart" width="400" height="200"></canvas>
        </div>
      </div>
      <div>
        <h3 style="margin-bottom:16px;font-family:'Syne',sans-serif">Active Investments</h3>
        ${activeInvs.length ? activeInvs.map(inv => {
          const plan = PLANS.find(p => p.id === inv.planId);
          const progress = Math.min(((Date.now() - inv.startTime) / (plan.period * 24 * 60 * 60 * 1000)) * 100, 100);
          return `<div class="active-inv-card">
            <div class="active-inv-header">
              <div class="active-inv-name">${plan.name} Plan</div>
              <div class="active-inv-days">${Math.ceil((inv.startTime + plan.period*86400000 - Date.now())/86400000)} days left</div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:8px">
              <span>$${inv.amount} invested</span><span style="color:var(--green)">+$${(inv.earned||0).toFixed(2)} earned</span>
            </div>
            <div class="progress-wrap"><div class="progress-bar" style="width:${progress}%"></div></div>
            <div style="font-size:12px;color:var(--text2);margin-top:6px">${progress.toFixed(1)}% complete</div>
          </div>`;
        }).join('') : '<div style="text-align:center;padding:40px;color:var(--text2)">No active investments.<br><button class="btn-primary" style="margin-top:16px" onclick="showTab(\'invest\')">Start Investing</button></div>'}
      </div>
    </div>`;
}

function drawDashChart() {
  setTimeout(() => {
    const canvas = document.getElementById('dashChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const months = ['Jan','Feb','Mar','Apr','May','Jun'];
    const base = state.balance || 100;
    const data = months.map((_, i) => base * (1 + i * 0.15 + Math.random() * 0.05));
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0b0f00';
    const pad = 40;
    const chartW = w - pad * 2, chartH = h - pad * 2;
    const max = Math.max(...data, 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px DM Sans';
      ctx.fillText('$' + Math.round(max - (max/4)*i), 2, y + 4);
    }
    const grad = ctx.createLinearGradient(0, pad, 0, h - pad);
    grad.addColorStop(0, 'rgba(240,180,41,0.25)');
    grad.addColorStop(1, 'rgba(240,180,41,0)');
    ctx.beginPath();
    data.forEach((val, i) => {
      const x = pad + (i / (data.length - 1)) * chartW;
      const y = pad + (1 - val/max) * chartH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.lineTo(pad + chartW, h - pad); ctx.lineTo(pad, h - pad); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    months.forEach((m, i) => {
      const x = pad + (i / (data.length - 1)) * chartW;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px DM Sans';
      ctx.textAlign = 'center';
      ctx.fillText(m, x, h - 8);
    });
  }, 100);
}

// ===================== INVEST TAB =====================
function renderInvestTab(selectedPlanId = null) {
  return `
    <div class="dash-title">Choose Investment Plan</div>
    <div class="invest-grid">
      ${PLANS.map(p => `
        <div class="invest-plan-card ${selectedPlanId === p.id ? 'featured' : ''}" style="border-top:3px solid ${p.color}" onclick="openInvestModal(${p.id})">
          <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;margin-bottom:6px">${p.name}</div>
          <div style="font-size:40px;font-weight:800;color:${p.color};font-family:'Syne',sans-serif">${p.roi}%</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:16px">Daily ROI • ${p.duration}</div>
          <div style="font-size:13px;color:var(--text2)">Min: <strong style="color:var(--text)">$${p.min.toLocaleString()}</strong></div>
          <div style="font-size:13px;color:var(--text2)">Max: <strong style="color:var(--text)">$${p.max.toLocaleString()}</strong></div>
          <button class="btn-green" style="margin-top:16px">Invest Now</button>
        </div>`).join('')}
    </div>`;
}

function openInvestModal(planId) {
  const plan = PLANS.find(p => p.id === planId);
  const content = document.getElementById('modalContent');
  document.getElementById('modalOverlay').classList.add('active');
  content.innerHTML = `
    <div class="modal-title">Invest in ${plan.name}</div>
    <div class="modal-sub">${plan.roi}% daily ROI for ${plan.period} days</div>
    <div class="stat-card" style="margin-bottom:20px;text-align:center">
      <div class="stat-card-label">Your Available Balance</div>
      <div class="stat-card-val">$${state.balance.toFixed(2)}</div>
    </div>
    <div class="form-group">
      <label>Investment Amount (USD)</label>
      <input class="form-control" id="investAmt" type="number" min="${plan.min}" max="${Math.min(plan.max, state.balance)}" placeholder="Min $${plan.min}">
    </div>
    <div id="investCalc" style="background:var(--bg3);border-radius:10px;padding:16px;margin-bottom:16px;font-size:14px;display:none">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text2)">Daily Profit:</span><span id="calcDaily" style="color:var(--green);font-weight:700"></span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text2)">Total Return:</span><span id="calcTotal" style="color:var(--gold);font-weight:700"></span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Net Profit:</span><span id="calcProfit" style="color:var(--green);font-weight:700"></span></div>
    </div>
    <button class="btn-green" onclick="makeInvestment(${planId})">Confirm Investment</button>
    <button class="btn-ghost" style="width:100%;margin-top:8px" onclick="closeModalDirect()">Cancel</button>`;
  document.getElementById('investAmt').addEventListener('input', function() {
    const amt = parseFloat(this.value);
    const calc = document.getElementById('investCalc');
    if (amt >= plan.min) {
      calc.style.display = 'block';
      document.getElementById('calcDaily').textContent = '$' + (amt * plan.roi / 100).toFixed(2);
      document.getElementById('calcTotal').textContent = '$' + (amt + amt * plan.roi / 100 * plan.period).toFixed(2);
      document.getElementById('calcProfit').textContent = '$' + (amt * plan.roi / 100 * plan.period).toFixed(2);
    } else { calc.style.display = 'none'; }
  });
}

function makeInvestment(planId) {
  const plan = PLANS.find(p => p.id === planId);
  const amt = parseFloat(document.getElementById('investAmt').value);
  if (!amt || amt < plan.min) { showToast('Minimum investment is $' + plan.min, 'error'); return; }
  if (amt > state.balance) { showToast('Insufficient balance. Please deposit first.', 'error'); return; }
  state.balance -= amt;
  state.invested += amt;
  const inv = { id: Date.now(), planId, amount: amt, startTime: Date.now(), status: 'active', earned: 0, credited: 0 };
  state.investments.push(inv);
  addTransaction('investment', amt, plan.name + ' Plan Investment', 'success');
  saveUserData();
  closeModalDirect();
  showTab('overview');
  showToast('Investment of $' + amt.toFixed(2) + ' activated! 🚀', 'success');
}

// ===================== DEPOSIT =====================
function renderDeposit() {
  return `
    <div class="dash-title">Deposit Funds</div>
    <div class="two-col">
      <div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:20px">Select Payment Method</h3>
          <div class="form-group">
            <label>Payment Method</label>
            <select class="form-control" id="depMethod" onchange="updateDepositInstructions()">
              <option value="btc">Bitcoin (BTC)</option>
              <option value="eth">Ethereum (ETH)</option>
              <option value="usdt">USDT (TRC20)</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </div>
          <div class="form-group">
            <label>Amount (USD)</label>
            <input class="form-control" id="depAmount" type="number" min="100" placeholder="Minimum $100">
          </div>
          <div id="depInstructions" style="background:var(--bg3);border-radius:12px;padding:20px;margin-bottom:20px">
            <div style="font-size:12px;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Send to this BTC address:</div>
            <div style="font-size:13px;word-break:break-all;font-family:monospace;color:var(--gold);background:var(--bg);padding:12px;border-radius:8px;margin-bottom:12px">bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh</div>
            <div style="font-size:12px;color:var(--text2)">⚠️ Send only BTC to this address. After sending, upload proof below.</div>
          </div>
          <div class="form-group">
            <label>Upload Payment Proof</label>
            <input class="form-control" type="file" id="depProof" accept="image/*">
          </div>
          <button class="btn-primary btn-full" onclick="submitDeposit()">Submit Deposit</button>
        </div>
      </div>
      <div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:20px">Deposit Information</h3>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div style="display:flex;gap:12px;align-items:flex-start"><span style="font-size:24px">⚡</span><div><div style="font-weight:600;margin-bottom:4px">Instant Activation</div><div style="font-size:14px;color:var(--text2)">Deposits are confirmed after 1–3 network confirmations</div></div></div>
            <div style="display:flex;gap:12px;align-items:flex-start"><span style="font-size:24px">🔒</span><div><div style="font-weight:600;margin-bottom:4px">Secure & Encrypted</div><div style="font-size:14px;color:var(--text2)">All transactions protected by 256-bit SSL encryption</div></div></div>
            <div style="display:flex;gap:12px;align-items:flex-start"><span style="font-size:24px">💱</span><div><div style="font-weight:600;margin-bottom:4px">Multiple Options</div><div style="font-size:14px;color:var(--text2)">Deposit via BTC, ETH, USDT, or bank wire</div></div></div>
            <div style="display:flex;gap:12px;align-items:flex-start"><span style="font-size:24px">📞</span><div><div style="font-weight:600;margin-bottom:4px">24/7 Support</div><div style="font-size:14px;color:var(--text2)">Our team is ready to assist with any deposit issues</div></div></div>
          </div>
          <div style="background:rgba(240,180,41,0.08);border:1px solid rgba(240,180,41,0.2);border-radius:10px;padding:16px;margin-top:20px">
            <div style="font-size:13px;color:var(--gold);font-weight:700;margin-bottom:4px">⚠️ Important</div>
            <div style="font-size:13px;color:var(--text2)">Always double-check the wallet address before sending. Transactions cannot be reversed once confirmed on the blockchain.</div>
          </div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px;margin-top:20px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:16px">Demo: Add Test Balance</h3>
          <p style="font-size:14px;color:var(--text2);margin-bottom:16px">For demo purposes, add funds directly to test the platform.</p>
          <div class="form-group"><label>Test Amount</label><input class="form-control" id="testAmt" type="number" placeholder="e.g. 1000" value="1000"></div>
          <button class="btn-green" onclick="addTestBalance()">Add Test Balance</button>
        </div>
      </div>
    </div>`;
}

function updateDepositInstructions() {
  const method = document.getElementById('depMethod').value;
  const div = document.getElementById('depInstructions');
  const addresses = {
    btc: { label: 'BTC Address', addr: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', note: 'Send only BTC to this address.' },
    eth: { label: 'ETH Address', addr: '0x742d35Cc6634C0532925a3b8D4C9C4E...', note: 'Send only ETH or ERC-20 tokens.' },
    usdt: { label: 'USDT TRC20 Address', addr: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7', note: 'Send only USDT TRC20.' },
    bank: { label: 'Bank Wire Details', addr: 'Account: LuminaVest Holdings\nBank: First International Bank\nIBAN: GB29 NWBK 6016 1331 9268 19\nSwift: NWBKGB2L', note: 'Use your username as reference.' }
  };
  const m = addresses[method];
  div.innerHTML = `<div style="font-size:12px;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">${m.label}:</div>
    <div style="font-size:13px;word-break:break-all;font-family:monospace;color:var(--gold);background:var(--bg);padding:12px;border-radius:8px;margin-bottom:12px;white-space:pre-wrap">${m.addr}</div>
    <div style="font-size:12px;color:var(--text2)">⚠️ ${m.note}</div>`;
}

function submitDeposit() {
  const amt = parseFloat(document.getElementById('depAmount').value);
  const method = document.getElementById('depMethod').value;
  if (!amt || amt < 100) { showToast('Minimum deposit is $100', 'error'); return; }
  addTransaction('deposit', amt, method.toUpperCase() + ' Deposit', 'pending');
  saveUserData();
  showToast('Deposit request submitted! Pending confirmation.', 'success');
  showTab('history');
}

function addTestBalance() {
  const amt = parseFloat(document.getElementById('testAmt').value) || 1000;
  state.balance += amt;
  addTransaction('deposit', amt, 'Test Balance Added', 'success');
  saveUserData();
  showToast('$' + amt.toFixed(2) + ' added to your balance! 💰', 'success');
  showTab('overview');
}

// ===================== WITHDRAW =====================
function renderWithdraw() {
  return `
    <div class="dash-title">Withdraw Funds</div>
    <div class="two-col">
      <div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px">
          <div style="background:var(--bg3);border-radius:10px;padding:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center">
            <span style="color:var(--text2)">Available Balance</span>
            <span style="font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:var(--green)">$${state.balance.toFixed(2)}</span>
          </div>
          <div class="form-group">
            <label>Withdrawal Method</label>
            <select class="form-control" id="withMethod">
              <option value="btc">Bitcoin (BTC)</option>
              <option value="eth">Ethereum (ETH)</option>
              <option value="usdt">USDT (TRC20)</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </div>
          <div class="form-group">
            <label>Wallet / Account Address</label>
            <input class="form-control" id="withAddr" placeholder="Enter your wallet address or bank details">
          </div>
          <div class="form-group">
            <label>Amount (USD)</label>
            <input class="form-control" id="withAmt" type="number" min="50" max="${state.balance}" placeholder="Min $50">
          </div>
          <div style="background:rgba(255,77,106,0.05);border:1px solid rgba(255,77,106,0.15);border-radius:10px;padding:14px;margin-bottom:20px;font-size:13px;color:var(--text2)">
            <strong style="color:var(--red)">⚠️ Note:</strong> Withdrawals are processed within 24 hours. A 2% processing fee applies.
          </div>
          <button class="btn-green" onclick="submitWithdraw()">Request Withdrawal</button>
        </div>
      </div>
      <div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:20px">Withdrawal Summary</h3>
          <div style="display:flex;flex-direction:column;gap:16px;font-size:14px">
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Total Invested</span><span>$${state.invested.toFixed(2)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Total Profits</span><span style="color:var(--green)">$${state.profits.toFixed(2)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Total Withdrawn</span><span>$${state.withdrawn.toFixed(2)}</span></div>
            <div style="border-top:1px solid var(--border);padding-top:16px;display:flex;justify-content:space-between"><span style="font-weight:700">Available to Withdraw</span><span style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--green)">$${state.balance.toFixed(2)}</span></div>
          </div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px;margin-top:20px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:16px">Processing Times</h3>
          <div style="display:flex;flex-direction:column;gap:12px;font-size:14px">
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">BTC / ETH / USDT</span><span style="color:var(--green)">Instant – 2hrs</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Bank Transfer</span><span>1–3 Business Days</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Processing Fee</span><span>2%</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Min Withdrawal</span><span>$50</span></div>
          </div>
        </div>
      </div>
    </div>`;
}

function submitWithdraw() {
  const amt = parseFloat(document.getElementById('withAmt').value);
  const addr = document.getElementById('withAddr').value.trim();
  const method = document.getElementById('withMethod').value;
  if (!amt || amt < 50) { showToast('Minimum withdrawal is $50', 'error'); return; }
  if (amt > state.balance) { showToast('Insufficient balance', 'error'); return; }
  if (!addr) { showToast('Please enter your wallet address', 'error'); return; }
  const fee = amt * 0.02;
  const net = amt - fee;
  state.balance -= amt;
  state.withdrawn += net;
  addTransaction('withdrawal', amt, method.toUpperCase() + ' Withdrawal to ' + addr.substring(0,12) + '...', 'pending');
  saveUserData();
  showToast('Withdrawal of $' + net.toFixed(2) + ' (after fee) submitted! Processing...', 'success');
  showTab('history');
}

// ===================== HISTORY =====================
function addTransaction(type, amount, note, status) {
  state.transactions.unshift({ id: Date.now(), type, amount, note, status, date: new Date().toLocaleString() });
  if (state.transactions.length > 100) state.transactions.pop();
}

function renderHistory() {
  const txs = state.transactions;
  return `
    <div class="dash-title">Transaction History</div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      ${txs.length ? `<table class="history-table">
        <thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${txs.map(tx => `
          <tr>
            <td style="color:var(--text2);font-size:13px">${tx.date}</td>
            <td><span style="text-transform:capitalize;font-weight:600">${tx.type}</span></td>
            <td style="color:var(--text2);font-size:13px">${tx.note}</td>
            <td style="font-weight:700;color:${tx.type==='withdrawal'?'var(--red)':'var(--green)'}">
              ${tx.type==='withdrawal'?'-':'+'} $${tx.amount.toFixed(2)}
            </td>
            <td><span class="badge badge-${tx.status==='success'?'success':tx.status==='pending'?'pending':'fail'}">${tx.status}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<div style="text-align:center;padding:60px;color:var(--text2)">No transactions yet. Make a deposit to get started!</div>'}
    </div>`;
}

// ===================== REFERRAL =====================
function renderReferral() {
  const refUrl = 'https://luminavest.com/ref/' + state.user.refCode;
  return `
    <div class="dash-title">Referral Program</div>
    <div style="background:linear-gradient(135deg,rgba(240,180,41,0.1),var(--card));border:1px solid rgba(240,180,41,0.2);border-radius:var(--radius);padding:32px;margin-bottom:24px;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">🤝</div>
      <h3 style="font-family:'Syne',sans-serif;font-size:24px;margin-bottom:8px">Earn 5% Commission</h3>
      <p style="color:var(--text2);max-width:400px;margin:0 auto">Invite friends and earn 5% of every investment they make. Paid instantly to your balance.</p>
    </div>
    <div class="two-col">
      <div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:16px">Your Referral Code</h3>
          <div class="ref-code-box">
            <div class="ref-code">${state.user.refCode}</div>
            <button class="copy-btn" onclick="copyRef('${state.user.refCode}')">Copy</button>
          </div>
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:12px;font-size:16px">Your Referral Link</h3>
          <div style="background:var(--bg3);border-radius:10px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
            <div style="font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${refUrl}</div>
            <button class="copy-btn" onclick="copyRef('${refUrl}')">Copy</button>
          </div>
          <div style="display:flex;gap:12px">
            <button class="btn-outline" style="flex:1;padding:12px;font-size:14px" onclick="shareRef('${refUrl}','whatsapp')">📱 WhatsApp</button>
            <button class="btn-outline" style="flex:1;padding:12px;font-size:14px" onclick="shareRef('${refUrl}','telegram')">✈️ Telegram</button>
            <button class="btn-outline" style="flex:1;padding:12px;font-size:14px" onclick="shareRef('${refUrl}','twitter')">🐦 Twitter</button>
          </div>
        </div>
      </div>
      <div>
        <div class="stats-row" style="grid-template-columns:1fr 1fr;margin-bottom:20px">
          <div class="stat-card"><div class="stat-card-label">Total Referrals</div><div class="stat-card-val">${state.referrals.length}</div></div>
          <div class="stat-card"><div class="stat-card-label">Commission Earned</div><div class="stat-card-val" style="color:var(--green)">$${state.referralEarnings.toFixed(2)}</div></div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:16px">How It Works</h3>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div style="display:flex;gap:12px;align-items:flex-start"><span style="background:var(--gold);color:#000;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0">1</span><div style="font-size:14px;color:var(--text2)">Share your unique referral code or link with friends</div></div>
            <div style="display:flex;gap:12px;align-items:flex-start"><span style="background:var(--gold);color:#000;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0">2</span><div style="font-size:14px;color:var(--text2)">They register and make their first investment</div></div>
            <div style="display:flex;gap:12px;align-items:flex-start"><span style="background:var(--gold);color:#000;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0">3</span><div style="font-size:14px;color:var(--text2)">You instantly earn 5% commission on their investment — forever</div></div>
          </div>
        </div>
      </div>
    </div>`;
}

function copyRef(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard! 📋', 'success'));
}
function shareRef(url, platform) {
  const urls = {
    whatsapp: `https://wa.me/?text=Join LuminaVest and start earning daily returns! Use my link: ${url}`,
    telegram: `https://t.me/share/url?url=${url}&text=Join LuminaVest - Smart Investment Platform`,
    twitter: `https://twitter.com/intent/tweet?text=Earning daily returns with LuminaVest! Join using my link:&url=${url}`
  };
  window.open(urls[platform], '_blank');
}

// ===================== PROFILE =====================
function renderProfile() {
  const u = state.user;
  const initials = u.firstName[0] + u.lastName[0];
  return `
    <div class="dash-title">My Profile</div>
    <div class="two-col">
      <div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:32px">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:28px">
            <div class="profile-avatar">${initials}</div>
            <div>
              <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800">${u.firstName} ${u.lastName}</div>
              <div style="color:var(--text2);font-size:14px">${u.email}</div>
              <div style="display:inline-block;background:rgba(0,230,118,0.1);color:var(--green);padding:4px 12px;border-radius:100px;font-size:12px;font-weight:700;margin-top:6px">✓ Active Investor</div>
            </div>
          </div>
          <div class="form-group"><label>First Name</label><input class="form-control" id="pFirst" value="${u.firstName}"></div>
          <div class="form-group"><label>Last Name</label><input class="form-control" id="pLast" value="${u.lastName}"></div>
          <div class="form-group"><label>Email</label><input class="form-control" id="pEmail" value="${u.email}" type="email"></div>
          <div class="form-group"><label>Phone</label><input class="form-control" id="pPhone" value="${u.phone || ''}" type="tel"></div>
          <button class="btn-primary btn-full" onclick="updateProfile()">Save Changes</button>
        </div>
      </div>
      <div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px;margin-bottom:20px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:16px">Change Password</h3>
          <div class="form-group"><label>Current Password</label><input class="form-control" id="curPass" type="password" placeholder="••••••••"></div>
          <div class="form-group"><label>New Password</label><input class="form-control" id="newPass" type="password" placeholder="Min 8 characters"></div>
          <div class="form-group"><label>Confirm New Password</label><input class="form-control" id="confPass" type="password" placeholder="Repeat new password"></div>
          <button class="btn-ghost" style="width:100%" onclick="changePassword()">Update Password</button>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:28px">
          <h3 style="font-family:'Syne',sans-serif;margin-bottom:16px">Account Details</h3>
          <div style="display:flex;flex-direction:column;gap:12px;font-size:14px">
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Member Since</span><span>${new Date(u.joinDate).toLocaleDateString()}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Account ID</span><span style="font-family:monospace">#${u.id.toString().slice(-6)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Referral Code</span><span style="color:var(--gold);font-weight:700">${u.refCode}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">KYC Status</span><span style="color:var(--gold)">Pending Verification</span></div>
          </div>
          <button class="btn-outline" style="width:100%;margin-top:16px;padding:12px;font-size:14px" onclick="showToast('KYC verification coming soon!','success')">📋 Complete KYC</button>
        </div>
      </div>
    </div>`;
}

function updateProfile() {
  const users = JSON.parse(localStorage.getItem('luminavest_users') || '[]');
  state.user.firstName = document.getElementById('pFirst').value.trim() || state.user.firstName;
  state.user.lastName = document.getElementById('pLast').value.trim() || state.user.lastName;
  state.user.email = document.getElementById('pEmail').value.trim() || state.user.email;
  state.user.phone = document.getElementById('pPhone').value.trim();
  const idx = users.findIndex(u => u.id === state.user.id);
  if (idx !== -1) { users[idx] = state.user; localStorage.setItem('luminavest_users', JSON.stringify(users)); }
  localStorage.setItem('luminavest_user', JSON.stringify(state.user));
  document.getElementById('dashUserName').textContent = state.user.firstName + ' ' + state.user.lastName;
  showToast('Profile updated successfully! ✅', 'success');
}

function changePassword() {
  const cur = document.getElementById('curPass').value;
  const nw = document.getElementById('newPass').value;
  const conf = document.getElementById('confPass').value;
  if (!cur || cur !== state.user.password) { showToast('Current password is incorrect', 'error'); return; }
  if (nw.length < 8) { showToast('New password must be at least 8 characters', 'error'); return; }
  if (nw !== conf) { showToast('Passwords do not match', 'error'); return; }
  const users = JSON.parse(localStorage.getItem('luminavest_users') || '[]');
  state.user.password = nw;
  const idx = users.findIndex(u => u.id === state.user.id);
  if (idx !== -1) { users[idx] = state.user; localStorage.setItem('luminavest_users', JSON.stringify(users)); }
  localStorage.setItem('luminavest_user', JSON.stringify(state.user));
  showToast('Password changed successfully! 🔒', 'success');
}

// ===================== TOAST =====================
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => { toast.classList.remove('show'); }, 3500);
}

// ===================== LIVE PROFIT TICKER =====================
setInterval(() => {
  if (!state.user) return;
  const activeInvs = state.investments.filter(i => i.status === 'active');
  if (!activeInvs.length) return;
  activeInvs.forEach(inv => {
    const plan = PLANS.find(p => p.id === inv.planId);
    const secondlyROI = (inv.amount * plan.roi / 100) / 86400;
    inv.earned = (inv.earned || 0) + secondlyROI;
    state.profits += secondlyROI;
  });
  saveUserData();
}, 1000);
