/**
 * ╔══════════════════════════════════════════╗
 * ║       PESA GROW — NODE.JS BACKEND        ║
 * ║  Express + SQLite | REST API             ║
 * ╚══════════════════════════════════════════╝
 *
 * SETUP INSTRUCTIONS:
 * 1. npm install express better-sqlite3 bcryptjs jsonwebtoken cors dotenv multer express-rate-limit
 * 2. cp .env.example .env && edit .env
 * 3. node server.js
 *
 * Runs on: http://localhost:3000
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pesagrow_secret_2026_change_this';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'PesaGrow@2026';

// ── DATABASE ──────────────────────────────────
const db = new Database('./pesagrow.db');

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    firstName TEXT NOT NULL,
    lastName TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT NOT NULL,
    balance REAL DEFAULT 0,
    totalDeposited REAL DEFAULT 0,
    totalWithdrawn REAL DEFAULT 0,
    totalProfits REAL DEFAULT 0,
    refCode TEXT UNIQUE,
    referredBy TEXT,
    referralEarnings REAL DEFAULT 0,
    kycStatus TEXT DEFAULT 'pending',
    suspended INTEGER DEFAULT 0,
    joinDate TEXT NOT NULL,
    lastLogin TEXT,
    FOREIGN KEY(referredBy) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    roi REAL NOT NULL,
    period INTEGER NOT NULL,
    minAmount REAL NOT NULL,
    maxAmount REAL NOT NULL,
    color TEXT DEFAULT '#39d353',
    active INTEGER DEFAULT 1,
    featured INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS investments (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    planId INTEGER NOT NULL,
    amount REAL NOT NULL,
    startTime INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    earned REAL DEFAULT 0,
    credited REAL DEFAULT 0,
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(planId) REFERENCES plans(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT,
    reference TEXT,
    address TEXT,
    note TEXT,
    status TEXT DEFAULT 'pending',
    date TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    subject TEXT NOT NULL,
    category TEXT,
    message TEXT NOT NULL,
    reply TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    date TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT
  );
`);

// ── SEED DEFAULT DATA ─────────────────────────
function seedDefaults() {
  // Seed plans if empty
  const planCount = db.prepare('SELECT COUNT(*) as c FROM plans').get().c;
  if (planCount === 0) {
    const insertPlan = db.prepare('INSERT INTO plans (name,roi,period,minAmount,maxAmount,color,active,featured) VALUES (?,?,?,?,?,?,?,?)');
    insertPlan.run('Starter', 3, 7, 1000, 9999, '#58a6ff', 1, 0);
    insertPlan.run('Growth', 5, 14, 10000, 49999, '#39d353', 1, 0);
    insertPlan.run('Gold', 8, 21, 50000, 199999, '#f0a500', 1, 1);
    insertPlan.run('Platinum', 12, 30, 200000, 9999999, '#7c6af7', 1, 0);
    console.log('✅ Default plans seeded');
  }

  // Seed settings
  const defaultSettings = {
    siteName: 'Pesa Grow',
    phone: '0796820013',
    whatsapp: '254796820013',
    email: 'support@pesagrow.co.ke',
    minDeposit: '1000',
    minWithdraw: '500',
    refCommission: '5',
    currency: 'KES',
  };
  const upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) upsertSetting.run(k, v);

  // Seed admin
  const adminCount = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync(ADMIN_PASS, 10);
    db.prepare('INSERT INTO admins (username, password, name) VALUES (?, ?, ?)').run(ADMIN_USER, hash, 'Super Admin');
    console.log('✅ Admin seeded — user:', ADMIN_USER, '| pass:', ADMIN_PASS);
  }
}
seedDefaults();

// ── MIDDLEWARE ────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many requests' } });
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 120 });
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// ── JWT MIDDLEWARE ────────────────────────────
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(header.split(' ')[1], JWT_SECRET);
    if (!payload.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    req.admin = payload;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ── HELPERS ───────────────────────────────────
const uid = () => 'U' + Date.now() + Math.random().toString(36).substring(2, 6);
const tid = () => 'T' + Date.now() + Math.random().toString(36).substring(2, 6);
const iid = () => 'I' + Date.now() + Math.random().toString(36).substring(2, 6);
const tkid = () => 'TK' + Date.now() + Math.random().toString(36).substring(2, 6);
const refCode = () => 'PG-' + Math.random().toString(36).substring(2, 8).toUpperCase();
const getSettings = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
};

// ── AUTH ROUTES ───────────────────────────────
// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, email, phone, password, referralCode } = req.body;
  if (!firstName || !lastName || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  let referredBy = null;
  if (referralCode) {
    const ref = db.prepare('SELECT id FROM users WHERE refCode = ?').get(referralCode.toUpperCase());
    if (!ref) return res.status(400).json({ error: 'Invalid referral code' });
    referredBy = ref.id;
  }

  const hash = await bcrypt.hash(password, 10);
  const id = uid();
  db.prepare(`INSERT INTO users (id,firstName,lastName,email,phone,password,refCode,referredBy,joinDate,lastLogin)
    VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, firstName, lastName, email, phone || '', hash, refCode(), referredBy, new Date().toISOString(), new Date().toISOString());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.suspended) return res.status(403).json({ error: 'Account suspended' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  db.prepare('UPDATE users SET lastLogin = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// POST /api/auth/admin
app.post('/api/auth/admin', async (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, admin.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: admin.id, username: admin.username, isAdmin: true }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, admin: { id: admin.id, username: admin.username, name: admin.name } });
});

// ── USER ROUTES ───────────────────────────────
// GET /api/user/me
app.get('/api/user/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

// PUT /api/user/profile
app.put('/api/user/profile', authRequired, (req, res) => {
  const { firstName, lastName, phone } = req.body;
  db.prepare('UPDATE users SET firstName=?, lastName=?, phone=? WHERE id=?').run(firstName, lastName, phone, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

// PUT /api/user/password
app.put('/api/user/password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) return res.status(401).json({ error: 'Current password incorrect' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password too short' });
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, req.user.id);
  res.json({ success: true });
});

// ── PLANS ROUTES ──────────────────────────────
// GET /api/plans
app.get('/api/plans', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1').all();
  res.json(plans);
});

// ── INVESTMENTS ───────────────────────────────
// POST /api/investments
app.post('/api/investments', authRequired, (req, res) => {
  const { planId, amount } = req.body;
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(planId);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (amount < plan.minAmount) return res.status(400).json({ error: `Minimum investment is ${plan.minAmount}` });
  if (amount > plan.maxAmount) return res.status(400).json({ error: `Maximum investment is ${plan.maxAmount}` });
  if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  const id = iid();
  db.prepare('INSERT INTO investments (id,userId,planId,amount,startTime,status) VALUES (?,?,?,?,?,?)').run(id, user.id, planId, amount, Date.now(), 'active');
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, user.id);

  // Log transaction
  db.prepare('INSERT INTO transactions (id,userId,type,amount,method,status,date) VALUES (?,?,?,?,?,?,?)').run(tid(), user.id, 'investment', amount, plan.name + ' Plan', 'success', new Date().toISOString());

  // Check referral commission
  if (user.referredBy) {
    const settings = getSettings();
    const commPct = parseFloat(settings.refCommission || '5') / 100;
    const commission = amount * commPct;
    db.prepare('UPDATE users SET balance = balance + ?, referralEarnings = referralEarnings + ? WHERE id = ?').run(commission, commission, user.referredBy);
    db.prepare('INSERT INTO transactions (id,userId,type,amount,method,status,date) VALUES (?,?,?,?,?,?,?)').run(tid(), user.referredBy, 'commission', commission, 'Referral from ' + user.firstName, 'success', new Date().toISOString());
  }

  res.json({ id, success: true });
});

// GET /api/investments
app.get('/api/investments', authRequired, (req, res) => {
  const invs = db.prepare(`
    SELECT i.*, p.name as planName, p.roi, p.period, p.color
    FROM investments i JOIN plans p ON i.planId = p.id
    WHERE i.userId = ? ORDER BY i.startTime DESC
  `).all(req.user.id);
  res.json(invs);
});

// ── DEPOSITS ──────────────────────────────────
// POST /api/deposits
app.post('/api/deposits', authRequired, (req, res) => {
  const { amount, method, reference, note } = req.body;
  const settings = getSettings();
  const min = parseFloat(settings.minDeposit || '1000');
  if (!amount || amount < min) return res.status(400).json({ error: 'Minimum deposit is ' + min });
  if (!reference) return res.status(400).json({ error: 'Reference required' });

  db.prepare('INSERT INTO transactions (id,userId,type,amount,method,reference,note,status,date) VALUES (?,?,?,?,?,?,?,?,?)').run(
    tid(), req.user.id, 'deposit', amount, method, reference, note || '', 'pending', new Date().toISOString()
  );
  res.json({ success: true, message: 'Deposit request submitted for review' });
});

// ── WITHDRAWALS ───────────────────────────────
// POST /api/withdrawals
app.post('/api/withdrawals', authRequired, (req, res) => {
  const { amount, method, address } = req.body;
  const settings = getSettings();
  const min = parseFloat(settings.minWithdraw || '500');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!amount || amount < min) return res.status(400).json({ error: 'Minimum withdrawal is ' + min });
  if (amount > user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  if (!address) return res.status(400).json({ error: 'Address required' });

  db.prepare('INSERT INTO transactions (id,userId,type,amount,method,address,status,date) VALUES (?,?,?,?,?,?,?,?)').run(
    tid(), user.id, 'withdrawal', amount, method, address, 'pending', new Date().toISOString()
  );
  res.json({ success: true, message: 'Withdrawal request submitted' });
});

// ── TRANSACTIONS ──────────────────────────────
// GET /api/transactions
app.get('/api/transactions', authRequired, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE userId = ? ORDER BY date DESC LIMIT 100').all(req.user.id);
  res.json(txs);
});

// ── SUPPORT TICKETS ───────────────────────────
// POST /api/tickets
app.post('/api/tickets', authRequired, (req, res) => {
  const { subject, category, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message required' });
  db.prepare('INSERT INTO tickets (id,userId,subject,category,message,status,date) VALUES (?,?,?,?,?,?,?)').run(
    tkid(), req.user.id, subject, category || 'General', message, 'open', new Date().toISOString()
  );
  res.json({ success: true });
});

// GET /api/tickets
app.get('/api/tickets', authRequired, (req, res) => {
  const tickets = db.prepare('SELECT * FROM tickets WHERE userId = ? ORDER BY date DESC').all(req.user.id);
  res.json(tickets);
});

// ── ADMIN ROUTES ──────────────────────────────

// GET /api/admin/dashboard
app.get('/api/admin/dashboard', adminRequired, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as total FROM users').get();
  const activeInvs = db.prepare("SELECT COUNT(*) as total, SUM(amount) as staked FROM investments WHERE status='active'").get();
  const pendingDeps = db.prepare("SELECT COUNT(*) as total FROM transactions WHERE type='deposit' AND status='pending'").get();
  const pendingWiths = db.prepare("SELECT COUNT(*) as total FROM transactions WHERE type='withdrawal' AND status='pending'").get();
  const totalDep = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE type='deposit' AND status='success'").get();
  const totalWith = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE type='withdrawal' AND status='success'").get();
  const recentUsers = db.prepare("SELECT id,firstName,lastName,email,joinDate FROM users ORDER BY joinDate DESC LIMIT 5").all();
  const recentTxs = db.prepare("SELECT t.*, u.firstName, u.lastName FROM transactions t LEFT JOIN users u ON t.userId = u.id ORDER BY t.date DESC LIMIT 5").all();

  res.json({
    stats: {
      totalUsers: users.total,
      activeInvestments: activeInvs.total,
      stakedAmount: activeInvs.staked || 0,
      pendingDeposits: pendingDeps.total,
      pendingWithdrawals: pendingWiths.total,
      totalDeposited: totalDep.total || 0,
      totalWithdrawn: totalWith.total || 0,
    },
    recentUsers,
    recentTransactions: recentTxs,
  });
});

// GET /api/admin/users
app.get('/api/admin/users', adminRequired, (req, res) => {
  const { search, page = 1, limit = 50 } = req.query;
  let query = 'SELECT id,firstName,lastName,email,phone,balance,totalDeposited,totalWithdrawn,totalProfits,refCode,kycStatus,suspended,joinDate FROM users';
  const params = [];
  if (search) { query += ' WHERE firstName LIKE ? OR lastName LIKE ? OR email LIKE ?'; params.push('%'+search+'%', '%'+search+'%', '%'+search+'%'); }
  query += ' ORDER BY joinDate DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
  const users = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM users' + (search ? ' WHERE firstName LIKE ? OR lastName LIKE ? OR email LIKE ?' : '')).get(...(search ? ['%'+search+'%', '%'+search+'%', '%'+search+'%'] : [])).c;
  res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / limit) });
});

// GET /api/admin/users/:id
app.get('/api/admin/users/:id', adminRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = user;
  const invs = db.prepare('SELECT i.*,p.name as planName FROM investments i JOIN plans p ON i.planId=p.id WHERE i.userId=?').all(req.params.id);
  const txs = db.prepare('SELECT * FROM transactions WHERE userId=? ORDER BY date DESC').all(req.params.id);
  res.json({ user: safe, investments: invs, transactions: txs });
});

// PUT /api/admin/users/:id
app.put('/api/admin/users/:id', adminRequired, async (req, res) => {
  const { firstName, lastName, email, phone, balance, kycStatus, suspended, newPassword } = req.body;
  let updates = 'firstName=?, lastName=?, email=?, phone=?, balance=?, kycStatus=?, suspended=?';
  const params = [firstName, lastName, email, phone, balance, kycStatus, suspended ? 1 : 0];
  if (newPassword) {
    updates += ', password=?';
    params.push(await bcrypt.hash(newPassword, 10));
  }
  params.push(req.params.id);
  db.prepare(`UPDATE users SET ${updates} WHERE id=?`).run(...params);
  res.json({ success: true });
});

// POST /api/admin/users/:id/adjust-balance
app.post('/api/admin/users/:id/adjust-balance', adminRequired, (req, res) => {
  const { action, amount, note } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  let newBalance;
  if (action === 'add') newBalance = user.balance + amount;
  else if (action === 'subtract') newBalance = Math.max(0, user.balance - amount);
  else newBalance = amount;
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, req.params.id);
  db.prepare('INSERT INTO transactions (id,userId,type,amount,method,status,date) VALUES (?,?,?,?,?,?,?)').run(tid(), req.params.id, 'adjustment', amount, note || 'Admin adjustment', 'success', new Date().toISOString());
  res.json({ success: true, newBalance });
});

// GET /api/admin/investments
app.get('/api/admin/investments', adminRequired, (req, res) => {
  const invs = db.prepare(`
    SELECT i.*, u.firstName, u.lastName, u.email, p.name as planName, p.roi, p.period
    FROM investments i
    JOIN users u ON i.userId = u.id
    JOIN plans p ON i.planId = p.id
    ORDER BY i.startTime DESC
  `).all();
  res.json(invs);
});

// PUT /api/admin/investments/:id/cancel
app.put('/api/admin/investments/:id/cancel', adminRequired, (req, res) => {
  const inv = db.prepare('SELECT * FROM investments WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE investments SET status='cancelled' WHERE id=?").run(req.params.id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(inv.amount, inv.userId);
  res.json({ success: true });
});

// GET /api/admin/transactions
app.get('/api/admin/transactions', adminRequired, (req, res) => {
  const { type, status } = req.query;
  let q = 'SELECT t.*, u.firstName, u.lastName, u.email FROM transactions t LEFT JOIN users u ON t.userId=u.id WHERE 1=1';
  const params = [];
  if (type) { q += ' AND t.type=?'; params.push(type); }
  if (status) { q += ' AND t.status=?'; params.push(status); }
  q += ' ORDER BY t.date DESC';
  res.json(db.prepare(q).all(...params));
});

// PUT /api/admin/transactions/:id/approve
app.put('/api/admin/transactions/:id/approve', adminRequired, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  db.prepare("UPDATE transactions SET status='success' WHERE id=?").run(tx.id);
  if (tx.type === 'deposit') {
    db.prepare('UPDATE users SET balance = balance + ?, totalDeposited = totalDeposited + ? WHERE id = ?').run(tx.amount, tx.amount, tx.userId);
  } else if (tx.type === 'withdrawal') {
    const fee = tx.amount * 0.02;
    const net = tx.amount - fee;
    db.prepare('UPDATE users SET balance = balance - ?, totalWithdrawn = totalWithdrawn + ? WHERE id = ?').run(tx.amount, net, tx.userId);
  }
  res.json({ success: true });
});

// PUT /api/admin/transactions/:id/reject
app.put('/api/admin/transactions/:id/reject', adminRequired, (req, res) => {
  db.prepare("UPDATE transactions SET status='rejected' WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// ── ADMIN PLANS ───────────────────────────────
// GET /api/admin/plans
app.get('/api/admin/plans', adminRequired, (req, res) => {
  res.json(db.prepare('SELECT * FROM plans').all());
});

// POST /api/admin/plans
app.post('/api/admin/plans', adminRequired, (req, res) => {
  const { name, roi, period, minAmount, maxAmount, color, active, featured } = req.body;
  const r = db.prepare('INSERT INTO plans (name,roi,period,minAmount,maxAmount,color,active,featured) VALUES (?,?,?,?,?,?,?,?)').run(name, roi, period, minAmount, maxAmount, color || '#39d353', active ? 1 : 1, featured ? 1 : 0);
  res.json({ id: r.lastInsertRowid, success: true });
});

// PUT /api/admin/plans/:id
app.put('/api/admin/plans/:id', adminRequired, (req, res) => {
  const { name, roi, period, minAmount, maxAmount, color, active, featured } = req.body;
  db.prepare('UPDATE plans SET name=?,roi=?,period=?,minAmount=?,maxAmount=?,color=?,active=?,featured=? WHERE id=?').run(name, roi, period, minAmount, maxAmount, color, active ? 1 : 0, featured ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// ── ADMIN TICKETS ─────────────────────────────
// GET /api/admin/tickets
app.get('/api/admin/tickets', adminRequired, (req, res) => {
  const tickets = db.prepare('SELECT t.*, u.firstName, u.lastName, u.email FROM tickets t LEFT JOIN users u ON t.userId=u.id ORDER BY t.date DESC').all();
  res.json(tickets);
});

// PUT /api/admin/tickets/:id/reply
app.put('/api/admin/tickets/:id/reply', adminRequired, (req, res) => {
  const { reply } = req.body;
  db.prepare("UPDATE tickets SET reply=?, status='replied' WHERE id=?").run(reply, req.params.id);
  res.json({ success: true });
});

// PUT /api/admin/tickets/:id/resolve
app.put('/api/admin/tickets/:id/resolve', adminRequired, (req, res) => {
  db.prepare("UPDATE tickets SET status='resolved' WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// ── ADMIN SETTINGS ────────────────────────────
// GET /api/admin/settings
app.get('/api/admin/settings', adminRequired, (req, res) => {
  res.json(getSettings());
});

// PUT /api/admin/settings
app.put('/api/admin/settings', adminRequired, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) upsert.run(k, String(v));
  });
  updateMany(req.body);
  res.json({ success: true });
});

// PUT /api/admin/credentials
app.put('/api/admin/credentials', adminRequired, async (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  let q = 'UPDATE admins SET username=? WHERE id=?';
  const params = [username, req.admin.id];
  if (password && password.length >= 8) {
    q = 'UPDATE admins SET username=?, password=? WHERE id=?';
    params.splice(1, 0, await bcrypt.hash(password, 10));
  }
  db.prepare(q).run(...params);
  res.json({ success: true });
});

// ── PROFIT CRON (every 60s) ───────────────────
setInterval(() => {
  const invs = db.prepare("SELECT i.*, p.roi, p.period FROM investments i JOIN plans p ON i.planId=p.id WHERE i.status='active'").all();
  const now = Date.now();
  for (const inv of invs) {
    const elapsed = now - inv.startTime;
    const totalMs = inv.period * 86400000;
    const secROI = (inv.amount * inv.roi / 100) / 86400;
    const newEarned = inv.earned + secROI * 60; // per minute

    if (elapsed >= totalMs) {
      const profit = newEarned - (inv.credited || 0);
      db.prepare("UPDATE investments SET status='completed', earned=?, credited=? WHERE id=?").run(newEarned, newEarned, inv.id);
      db.prepare('UPDATE users SET balance = balance + ?, totalProfits = totalProfits + ? WHERE id = ?').run(inv.amount + profit, profit, inv.userId);
    } else {
      const delta = newEarned - (inv.earned || 0);
      db.prepare('UPDATE investments SET earned=? WHERE id=?').run(newEarned, inv.id);
      db.prepare('UPDATE users SET balance = balance + ?, totalProfits = totalProfits + ? WHERE id = ?').run(delta, delta, inv.userId);
    }
  }
}, 60000);

// ── CATCH-ALL → frontend ──────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌿 Pesa Grow Server running on http://localhost:${PORT}`);
  console.log(`📞 Support: 0796820013`);
  console.log(`🔐 Admin: ${ADMIN_USER} / ${ADMIN_PASS}\n`);
});

module.exports = app;
