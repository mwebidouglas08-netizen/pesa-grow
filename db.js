// ============================================================
//  PesaGrow — Core Database Layer (IndexedDB + Business Logic)
// ============================================================

const DB_NAME = 'PesaGrowDB';
const DB_VER  = 3;

let _db = null;

const DB = {
  async open() {
    if (_db) return _db;
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        const stores = {
          users:        { key: 'id', indexes: ['email','phone','refCode','status'] },
          investments:  { key: 'id', indexes: ['userId','planId','status'] },
          transactions: { key: 'id', indexes: ['userId','type','status'] },
          plans:        { key: 'id', indexes: ['name','active'] },
          withdrawals:  { key: 'id', indexes: ['userId','status'] },
          deposits:     { key: 'id', indexes: ['userId','status'] },
          referrals:    { key: 'id', indexes: ['referrerId','refereeId'] },
          settings:     { key: 'key' },
          messages:     { key: 'id', indexes: ['userId','status'] },
          notifications:{ key: 'id', indexes: ['userId','read'] },
        };
        for (const [name, cfg] of Object.entries(stores)) {
          if (db.objectStoreNames.contains(name)) continue;
          const store = db.createObjectStore(name, { keyPath: cfg.key, autoIncrement: cfg.key === 'id' });
          (cfg.indexes||[]).forEach(idx => store.createIndex(idx, idx, { unique: false }));
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  },

  async get(store, key) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  },

  async getAll(store) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  },

  async getByIndex(store, index, value) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).index(index).getAll(value);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  },

  async put(store, data) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(data);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  },

  async delete(store, key) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => res(true);
      req.onerror   = () => rej(req.error);
    });
  },

  async count(store) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }
};

// ============================================================
//  HELPERS
// ============================================================
const genId  = () => 'PG' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2,5).toUpperCase();
const genRef = () => 'REF' + Math.random().toString(36).substring(2,7).toUpperCase();
const hash   = s => btoa(unescape(encodeURIComponent(s + '_pesagrow_salt_2024')));
const now    = () => new Date().toISOString();
const fmt    = (n, d=2) => (+(n||0)).toFixed(d);
const fmtKES = n => 'KES ' + fmt(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ============================================================
//  SEED — default plans + admin on first run
// ============================================================
async function seedDefaults() {
  const plans = await DB.getAll('plans');
  if (!plans.length) {
    const defaultPlans = [
      { name:'Starter',  roi:3,  period:7,  min:1000,   max:9999,   color:'#22d3ee', active:true,  referralBonus:5,  description:'Perfect entry-level plan for new investors' },
      { name:'Silver',   roi:5,  period:14, min:10000,  max:49999,  color:'#a3a3a3', active:true,  referralBonus:5,  description:'Grow your portfolio with steady daily returns' },
      { name:'Gold',     roi:7,  period:21, min:50000,  max:199999, color:'#f59e0b', active:true,  referralBonus:7,  description:'High-performance plan for serious investors', popular:true },
      { name:'Platinum', roi:10, period:30, min:200000, max:9999999,color:'#8b5cf6', active:true,  referralBonus:10, description:'Maximum returns for elite investors' },
    ];
    for (const p of defaultPlans) await DB.put('plans', { ...p, id: genId(), createdAt: now() });
  }

  const settings = await DB.getAll('settings');
  if (!settings.length) {
    const defaults = {
      siteName: 'Pesa Grow', sitePhone: '0796820013', siteEmail: 'support@pesagrow.co.ke',
      currency: 'KES', minDeposit: 1000, minWithdraw: 500, withdrawFee: 2,
      mpesaName: 'PESA GROW LTD', mpesaTill: '0796820013',
      btcAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      ethAddress: '0x742d35Cc6634C0532925a3b8D4C9C4E7a91F',
      usdtAddress: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7',
      maintenanceMode: false, referralRate: 5, welcomeBonus: 0,
    };
    for (const [key, value] of Object.entries(defaults)) await DB.put('settings', { key, value });
  }

  // Seed admin
  const admins = await DB.getByIndex('users', 'email', 'admin@pesagrow.co.ke');
  if (!admins.length) {
    await DB.put('users', {
      id: genId(), firstName: 'Admin', lastName: 'PesaGrow',
      email: 'admin@pesagrow.co.ke', phone: '0796820013',
      password: hash('Admin@2024'), role: 'admin',
      status: 'active', balance: 0, totalInvested: 0,
      totalProfits: 0, totalWithdrawn: 0, refCode: 'ADMIN00',
      createdAt: now(), lastLogin: now()
    });
  }
}

// ============================================================
//  AUTH API
// ============================================================
const Auth = {
  async register({ firstName, lastName, email, phone, password, refCode }) {
    const existing = await DB.getByIndex('users', 'email', email);
    if (existing.length) throw new Error('Email already registered');
    const byPhone = await DB.getByIndex('users', 'phone', phone);
    if (byPhone.length) throw new Error('Phone number already registered');

    const s = await getSettings();
    const user = {
      id: genId(), firstName, lastName, email, phone,
      password: hash(password), role: 'user',
      status: 'active', balance: +(s.welcomeBonus||0),
      totalInvested: 0, totalProfits: 0, totalWithdrawn: 0,
      refCode: genRef(), referredBy: null,
      createdAt: now(), lastLogin: now(), kycStatus: 'none'
    };

    if (refCode) {
      const referrer = await DB.getByIndex('users', 'refCode', refCode);
      if (referrer.length) {
        user.referredBy = referrer[0].id;
        await DB.put('referrals', { id: genId(), referrerId: referrer[0].id, refereeId: user.id, earnings: 0, createdAt: now() });
      }
    }

    await DB.put('users', user);
    if (s.welcomeBonus > 0) {
      await addTransaction({ userId: user.id, type: 'bonus', amount: +s.welcomeBonus, description: 'Welcome bonus', status: 'completed' });
    }
    sessionStorage.setItem('pg_user', user.id);
    return { ...user, password: undefined };
  },

  async login(email, password) {
    const users = await DB.getByIndex('users', 'email', email);
    if (!users.length) throw new Error('Account not found');
    const user = users[0];
    if (user.password !== hash(password)) throw new Error('Incorrect password');
    if (user.status === 'suspended') throw new Error('Account suspended. Contact support: 0796820013');
    user.lastLogin = now();
    await DB.put('users', user);
    sessionStorage.setItem('pg_user', user.id);
    sessionStorage.setItem('pg_role', user.role);
    return { ...user, password: undefined };
  },

  async getMe() {
    const id = sessionStorage.getItem('pg_user');
    if (!id) return null;
    const user = await DB.get('users', id);
    if (!user) { sessionStorage.clear(); return null; }
    return { ...user, password: undefined };
  },

  logout() {
    sessionStorage.clear();
    window.location.href = 'index.html';
  }
};

// ============================================================
//  SETTINGS HELPER
// ============================================================
async function getSettings() {
  const all = await DB.getAll('settings');
  return Object.fromEntries(all.map(s => [s.key, s.value]));
}

// ============================================================
//  TRANSACTION HELPER
// ============================================================
async function addTransaction({ userId, type, amount, description, status = 'completed', meta = {} }) {
  const tx = { id: genId(), userId, type, amount, description, status, meta, createdAt: now() };
  await DB.put('transactions', tx);
  return tx;
}

// ============================================================
//  INVESTMENT API
// ============================================================
const Investments = {
  async create(userId, planId, amount) {
    const user = await DB.get('users', userId);
    const plan = await DB.get('plans', planId);
    const s    = await getSettings();

    if (!plan || !plan.active) throw new Error('Plan not available');
    if (amount < plan.min) throw new Error(`Minimum investment is ${fmtKES(plan.min)}`);
    if (amount > plan.max) throw new Error(`Maximum investment is ${fmtKES(plan.max)}`);
    if (user.balance < amount) throw new Error('Insufficient balance. Please deposit first.');

    user.balance       -= amount;
    user.totalInvested += amount;
    await DB.put('users', user);

    const inv = {
      id: genId(), userId, planId, planName: plan.name,
      amount, roi: plan.roi, period: plan.period,
      earned: 0, status: 'active',
      startDate: now(),
      endDate: new Date(Date.now() + plan.period * 86400000).toISOString(),
      lastCredited: now()
    };
    await DB.put('investments', inv);
    await addTransaction({ userId, type: 'investment', amount, description: `${plan.name} Plan Investment`, status: 'completed' });

    // Referral commission
    if (user.referredBy) {
      const refs = await DB.getByIndex('referrals', 'refereeId', userId);
      if (refs.length) {
        const commission = amount * (plan.referralBonus || s.referralRate) / 100;
        const referrer = await DB.get('users', user.referredBy);
        if (referrer) {
          referrer.balance += commission;
          await DB.put('users', referrer);
          refs[0].earnings += commission;
          await DB.put('referrals', refs[0]);
          await addTransaction({ userId: referrer.id, type: 'referral', amount: commission, description: `Referral commission from ${user.firstName}`, status: 'completed' });
          await addNotification(referrer.id, `You earned ${fmtKES(commission)} referral commission!`, 'success');
        }
      }
    }

    await addNotification(userId, `${plan.name} plan activated! Earning ${plan.roi}% daily.`, 'success');
    return inv;
  },

  async tick() {
    // Called periodically to credit profits
    const active = await DB.getByIndex('investments', 'status', 'active');
    for (const inv of active) {
      const now_ts = Date.now();
      const end_ts = new Date(inv.endDate).getTime();
      const last   = new Date(inv.lastCredited).getTime();
      const elapsed_secs = (now_ts - last) / 1000;
      const daily_rate   = inv.roi / 100;
      const per_second   = (inv.amount * daily_rate) / 86400;
      const credit       = per_second * elapsed_secs;

      inv.earned      += credit;
      inv.lastCredited = new Date().toISOString();

      if (now_ts >= end_ts) {
        inv.status = 'completed';
        const user = await DB.get('users', inv.userId);
        if (user) {
          user.balance       += inv.amount + inv.earned;
          user.totalProfits  += inv.earned;
          await DB.put('users', user);
          await addTransaction({ userId: inv.userId, type: 'profit', amount: inv.earned, description: `${inv.planName} matured — profit credited`, status: 'completed' });
          await addNotification(inv.userId, `Your ${inv.planName} investment matured! ${fmtKES(inv.earned)} profit credited.`, 'success');
        }
      }
      await DB.put('investments', inv);
    }
  },

  async getForUser(userId) {
    return DB.getByIndex('investments', 'userId', userId);
  }
};

// ============================================================
//  DEPOSIT API
// ============================================================
const Deposits = {
  async submit(userId, { amount, method, proofNote }) {
    const s = await getSettings();
    if (amount < s.minDeposit) throw new Error(`Minimum deposit is ${fmtKES(s.minDeposit)}`);
    const dep = {
      id: genId(), userId, amount, method, proofNote: proofNote||'',
      status: 'pending', createdAt: now(), reviewedAt: null, reviewedBy: null
    };
    await DB.put('deposits', dep);
    await addTransaction({ userId, type: 'deposit', amount, description: `${method} deposit - pending`, status: 'pending' });
    await addNotification(userId, `Deposit of ${fmtKES(amount)} submitted. Awaiting confirmation.`, 'info');
    return dep;
  },

  async approve(depId, adminId) {
    const dep = await DB.get('deposits', depId);
    if (!dep) throw new Error('Deposit not found');
    if (dep.status !== 'pending') throw new Error('Already processed');
    dep.status     = 'approved';
    dep.reviewedAt = now();
    dep.reviewedBy = adminId;
    await DB.put('deposits', dep);

    const user = await DB.get('users', dep.userId);
    user.balance += dep.amount;
    await DB.put('users', user);

    // Update linked transaction
    const txs = await DB.getByIndex('transactions', 'userId', dep.userId);
    const tx  = txs.find(t => t.type==='deposit' && t.amount===dep.amount && t.status==='pending');
    if (tx) { tx.status = 'completed'; await DB.put('transactions', tx); }

    await addNotification(dep.userId, `Deposit of ${fmtKES(dep.amount)} approved! Balance updated.`, 'success');
    return dep;
  },

  async reject(depId, adminId, reason) {
    const dep = await DB.get('deposits', depId);
    if (!dep) throw new Error('Not found');
    dep.status = 'rejected'; dep.rejectionReason = reason;
    dep.reviewedAt = now(); dep.reviewedBy = adminId;
    await DB.put('deposits', dep);
    const txs = await DB.getByIndex('transactions', 'userId', dep.userId);
    const tx  = txs.find(t => t.type==='deposit' && t.amount===dep.amount && t.status==='pending');
    if (tx) { tx.status = 'failed'; await DB.put('transactions', tx); }
    await addNotification(dep.userId, `Deposit of ${fmtKES(dep.amount)} rejected. Reason: ${reason}`, 'error');
    return dep;
  }
};

// ============================================================
//  WITHDRAWAL API
// ============================================================
const Withdrawals = {
  async submit(userId, { amount, method, address }) {
    const user = await DB.get('users', userId);
    const s    = await getSettings();
    if (amount < s.minWithdraw) throw new Error(`Minimum withdrawal is ${fmtKES(s.minWithdraw)}`);
    const fee = amount * (s.withdrawFee / 100);
    const net = amount - fee;
    if (user.balance < amount) throw new Error('Insufficient balance');
    user.balance -= amount;
    await DB.put('users', user);
    const w = {
      id: genId(), userId, amount, fee, net, method, address,
      status: 'pending', createdAt: now(), reviewedAt: null, reviewedBy: null
    };
    await DB.put('withdrawals', w);
    await addTransaction({ userId, type: 'withdrawal', amount, description: `${method} withdrawal — pending`, status: 'pending' });
    await addNotification(userId, `Withdrawal of ${fmtKES(amount)} submitted for processing.`, 'info');
    return w;
  },

  async approve(wId, adminId) {
    const w = await DB.get('withdrawals', wId);
    if (!w) throw new Error('Not found');
    if (w.status !== 'pending') throw new Error('Already processed');
    w.status = 'approved'; w.reviewedAt = now(); w.reviewedBy = adminId;
    await DB.put('withdrawals', w);
    const user = await DB.get('users', w.userId);
    user.totalWithdrawn += w.net;
    await DB.put('users', user);
    const txs = await DB.getByIndex('transactions', 'userId', w.userId);
    const tx  = txs.find(t => t.type==='withdrawal' && t.amount===w.amount && t.status==='pending');
    if (tx) { tx.status = 'completed'; await DB.put('transactions', tx); }
    await addNotification(w.userId, `Withdrawal of ${fmtKES(w.net)} (after fee) approved and sent!`, 'success');
    return w;
  },

  async reject(wId, adminId, reason) {
    const w = await DB.get('withdrawals', wId);
    if (!w) throw new Error('Not found');
    w.status = 'rejected'; w.rejectionReason = reason;
    w.reviewedAt = now(); w.reviewedBy = adminId;
    await DB.put('withdrawals', w);
    // Refund
    const user = await DB.get('users', w.userId);
    user.balance += w.amount;
    await DB.put('users', user);
    const txs = await DB.getByIndex('transactions', 'userId', w.userId);
    const tx  = txs.find(t => t.type==='withdrawal' && t.amount===w.amount && t.status==='pending');
    if (tx) { tx.status = 'failed'; await DB.put('transactions', tx); }
    await addNotification(w.userId, `Withdrawal rejected. ${fmtKES(w.amount)} refunded. Reason: ${reason}`, 'error');
    return w;
  }
};

// ============================================================
//  NOTIFICATIONS
// ============================================================
async function addNotification(userId, message, type = 'info') {
  await DB.put('notifications', { id: genId(), userId, message, type, read: false, createdAt: now() });
}

// ============================================================
//  ADMIN STATS
// ============================================================
async function getAdminStats() {
  const [users, investments, deposits, withdrawals, transactions] = await Promise.all([
    DB.getAll('users'), DB.getAll('investments'), DB.getAll('deposits'),
    DB.getAll('withdrawals'), DB.getAll('transactions')
  ]);

  const members     = users.filter(u => u.role !== 'admin');
  const activeInvs  = investments.filter(i => i.status === 'active');
  const pendingDeps = deposits.filter(d => d.status === 'pending');
  const pendingWds  = withdrawals.filter(w => w.status === 'pending');
  const totalDeposited  = deposits.filter(d=>d.status==='approved').reduce((a,d)=>a+d.amount,0);
  const totalWithdrawn  = withdrawals.filter(w=>w.status==='approved').reduce((a,w)=>a+w.net,0);
  const totalInvested   = investments.reduce((a,i)=>a+i.amount,0);
  const totalProfitPaid = transactions.filter(t=>t.type==='profit'&&t.status==='completed').reduce((a,t)=>a+t.amount,0);

  return {
    totalMembers: members.length, activeInvestors: [...new Set(activeInvs.map(i=>i.userId))].length,
    activeInvestments: activeInvs.length, pendingDeposits: pendingDeps.length,
    pendingWithdrawals: pendingWds.length, totalDeposited, totalWithdrawn,
    totalInvested, totalProfitPaid,
    revenue: totalDeposited - totalWithdrawn,
    recentUsers: members.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5),
    recentTx: transactions.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,10)
  };
}

// ============================================================
//  BOOT
// ============================================================
window.PG = { DB, Auth, Investments, Deposits, Withdrawals, getSettings, getAdminStats, addTransaction, addNotification, seedDefaults, genId, hash, now, fmt, fmtKES };

// Auto-seed and start profit ticker
(async () => {
  await seedDefaults();
  // Profit tick every 10 seconds
  setInterval(() => Investments.tick(), 10000);
})();
