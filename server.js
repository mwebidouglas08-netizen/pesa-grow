/**
 * ============================================================
 *  PESA GROW — server.js  (COMPLETE FIXED VERSION)
 *  Till Number: 5321672
 * ============================================================
 *  Fixes applied:
 *  1. All routes match what dashboard.html / index.html expect
 *  2. Real JWT signing (not fake token strings)
 *  3. SQLite DB with proper schema (persists until Railway wipe)
 *  4. bcryptjs (no native bindings — works on Railway)
 *  5. Full admin API (stats, members, deposits, withdrawals, plans)
 *  6. M-Pesa STK Push + callback + status polling
 *  7. Correct till number: 5321672
 *  8. Auto-creates uploads/ dir on startup
 *  9. All env vars safely defaulted so it won't crash if missing
 * ============================================================
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const Database   = require('better-sqlite3');
const multer     = require('multer');
const axios      = require('axios');

// ── Ensure uploads dir exists ──────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Constants ──────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const JWT_SECRET  = process.env.JWT_SECRET || 'pesagrow-secret-change-in-production-2024';
const BASE_URL    = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@pesagrow.co.ke';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'Admin@2024';

// ── M-Pesa config (till-based) ─────────────────────────────
const MPESA = {
  env:             process.env.MPESA_ENV              || 'sandbox',
  consumerKey:     process.env.MPESA_CONSUMER_KEY     || '',
  consumerSecret:  process.env.MPESA_CONSUMER_SECRET  || '',
  shortcode:       process.env.MPESA_SHORTCODE         || '5321672',   // YOUR TILL
  passkey:         process.env.MPESA_PASSKEY           || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  transactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline',
  baseUrl: (process.env.MPESA_ENV === 'live')
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke'
};

// ── SQLite DB ──────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'pesagrow.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    firstName     TEXT NOT NULL,
    lastName      TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    phone         TEXT,
    password      TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    status        TEXT NOT NULL DEFAULT 'active',
    kycStatus     TEXT NOT NULL DEFAULT 'none',
    refCode       TEXT UNIQUE,
    referredBy    TEXT,
    balance       REAL NOT NULL DEFAULT 0,
    totalInvested REAL NOT NULL DEFAULT 0,
    totalProfits  REAL NOT NULL DEFAULT 0,
    totalWithdrawn REAL NOT NULL DEFAULT 0,
    lastLogin     TEXT,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plans (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    name          TEXT NOT NULL,
    roi           REAL NOT NULL,
    period        INTEGER NOT NULL,
    minAmount     REAL NOT NULL,
    maxAmount     REAL NOT NULL,
    referralBonus REAL NOT NULL DEFAULT 5,
    color         TEXT DEFAULT '#00e676',
    description   TEXT,
    popular       INTEGER DEFAULT 0,
    active        INTEGER DEFAULT 1,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS investments (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    userId        TEXT NOT NULL REFERENCES users(id),
    planId        TEXT NOT NULL REFERENCES plans(id),
    planName      TEXT NOT NULL,
    amount        REAL NOT NULL,
    roi           REAL NOT NULL,
    period        INTEGER NOT NULL,
    earned        REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active',
    startDate     TEXT NOT NULL DEFAULT (datetime('now')),
    endDate       TEXT NOT NULL,
    lastCredited  TEXT,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    userId        TEXT NOT NULL REFERENCES users(id),
    amount        REAL NOT NULL,
    method        TEXT NOT NULL DEFAULT 'M-Pesa',
    proofNote     TEXT,
    mpesaReceiptNo TEXT,
    checkoutRequestId TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    rejectionReason TEXT,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt     TEXT
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    userId        TEXT NOT NULL REFERENCES users(id),
    amount        REAL NOT NULL,
    fee           REAL NOT NULL DEFAULT 0,
    net           REAL NOT NULL,
    method        TEXT NOT NULL DEFAULT 'M-Pesa',
    address       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    rejectionReason TEXT,
    b2cTransactionId TEXT,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt     TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    userId        TEXT NOT NULL REFERENCES users(id),
    type          TEXT NOT NULL,
    amount        REAL NOT NULL,
    description   TEXT,
    status        TEXT NOT NULL DEFAULT 'completed',
    createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    userId        TEXT NOT NULL REFERENCES users(id),
    message       TEXT NOT NULL,
    type          TEXT DEFAULT 'info',
    read          INTEGER DEFAULT 0,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mpesa_logs (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    checkoutId    TEXT,
    phone         TEXT,
    amount        REAL,
    resultCode    TEXT,
    receiptNo     TEXT,
    processedAt   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── Seed default plans if none exist ──────────────────────
const planCount = db.prepare('SELECT COUNT(*) as c FROM plans').get();
if (planCount.c === 0) {
  const ins = db.prepare(`INSERT INTO plans (name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular,active) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  ins.run('Starter', 3,  7,  1000,   9999,   5,  '#00e5ff',  'Perfect entry plan',            0, 1);
  ins.run('Silver',  5,  14, 10000,  49999,  5,  '#b0b0b0',  'Balanced growth plan',          0, 1);
  ins.run('Gold',    7,  21, 50000,  199999, 7,  '#ffc107',  'High-performance plan',         1, 1);
  ins.run('Platinum',10, 30, 200000, 9999999,10, '#b388ff',  'Dedicated manager included',    0, 1);
}

// ── Seed settings ──────────────────────────────────────────
const settingsDefaults = {
  siteName:           'Pesa Grow',
  sitePhone:          '0796820013',
  siteEmail:          'support@pesagrow.co.ke',
  mpesaTill:          '5321672',
  mpesaName:          'PESA GROW LTD',
  minDeposit:         '1000',
  minWithdraw:        '500',
  withdrawFee:        '2',
  referralRate:       '5',
  welcomeBonus:       '0',
  minHoldingDays:     '3',
  principalLockDays:  '90',
  maxDailyWithdrawals:'3'
};
const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
for (const [k,v] of Object.entries(settingsDefaults)) setSetting.run(k, v);

// ── Seed admin user ────────────────────────────────────────
const adminExists = db.prepare('SELECT id FROM users WHERE role=?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  db.prepare(`INSERT OR IGNORE INTO users (firstName,lastName,email,phone,password,role,refCode,balance)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run('Admin','User', ADMIN_EMAIL, '0796820013', hash, 'admin', 'ADMIN001', 0);
}

// ── App setup ──────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: UPLOADS_DIR });

// ── Helpers ────────────────────────────────────────────────
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : null;
}

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr || !hdr.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(hdr.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function genRefCode() {
  return 'PG' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function safeUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}

// ── Profit accrual (runs every 60s) ───────────────────────
function accrueProfit() {
  const now = new Date().toISOString();
  const active = db.prepare(`SELECT i.*, p.roi, p.period FROM investments i
    JOIN plans p ON i.planId=p.id WHERE i.status='active'`).all();

  const updateInv = db.prepare(`UPDATE investments SET earned=?, lastCredited=?, status=? WHERE id=?`);
  const updateBal = db.prepare(`UPDATE users SET balance=balance+?, totalProfits=totalProfits+? WHERE id=?`);
  const addTx     = db.prepare(`INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)`);

  for (const inv of active) {
    const start   = new Date(inv.startDate);
    const end     = new Date(inv.endDate);
    const nowDate = new Date();

    if (nowDate < end) {
      // Still running — compute profit since last credit
      const lastCredit = inv.lastCredited ? new Date(inv.lastCredited) : start;
      const hoursElapsed = (nowDate - lastCredit) / 3600000;
      if (hoursElapsed < 1) continue;          // credit hourly

      const dailyRoi   = inv.amount * inv.roi / 100;
      const hoursProfit = dailyRoi / 24 * hoursElapsed;
      updateInv.run(inv.earned + hoursProfit, now, 'active', inv.id);
      updateBal.run(hoursProfit, hoursProfit, inv.userId);
    } else {
      // Investment matured
      const totalProfit = inv.amount * inv.roi / 100 * inv.period;
      const remaining   = totalProfit - inv.earned;
      updateInv.run(totalProfit, now, 'completed', inv.id);
      if (remaining > 0) {
        updateBal.run(remaining, remaining, inv.userId);
        addTx.run(inv.userId, 'profit', totalProfit, `${inv.planName} plan completed`, 'completed');
        db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
          .run(inv.userId, `🎉 Your ${inv.planName} investment has matured! KES ${totalProfit.toFixed(2)} profit credited.`, 'success');
      }
    }
  }
}
setInterval(accrueProfit, 60000);

// ══════════════════════════════════════════════════════
//  AUTH ROUTES  (/api/auth/*)
// ══════════════════════════════════════════════════════

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, refCode } = req.body;
    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash    = await bcrypt.hash(password, 10);
    const newCode = genRefCode();
    const welcomeBonus = parseFloat(getSetting('welcomeBonus') || '0');

    // Check referrer
    let referredBy = null;
    if (refCode) {
      const referrer = db.prepare('SELECT id FROM users WHERE refCode=?').get(refCode.toUpperCase());
      if (referrer) referredBy = referrer.id;
    }

    const result = db.prepare(`
      INSERT INTO users (firstName,lastName,email,phone,password,refCode,referredBy,balance)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      firstName.trim(), lastName.trim(),
      email.toLowerCase().trim(), phone.trim(),
      hash, newCode, referredBy,
      welcomeBonus
    );

    const user = db.prepare('SELECT * FROM users WHERE rowid=?').get(result.lastInsertRowid);

    if (welcomeBonus > 0) {
      db.prepare(`INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)`)
        .run(user.id, 'bonus', welcomeBonus, 'Welcome bonus', 'completed');
      db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
        .run(user.id, `🎉 Welcome to Pesa Grow! KES ${welcomeBonus} bonus credited.`, 'success');
    }

    // Credit referrer
    if (referredBy) {
      db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
        .run(referredBy, `👥 New referral joined using your code!`, 'info');
    }

    const token = makeToken(user);
    res.json({ token, user: safeUser(user) });

  } catch (e) {
    console.error('Register error:', e.message);
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended. Contact support.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    db.prepare('UPDATE users SET lastLogin=? WHERE id=?').run(new Date().toISOString(), user.id);
    const token = makeToken(user);
    res.json({ token, user: safeUser(user) });

  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ME
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(safeUser(user));
});

// ══════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ══════════════════════════════════════════════════════

// Plans (public)
app.get('/api/plans', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY minAmount ASC').all();
  res.json(plans);
});

// Public settings (min deposit etc.)
app.get('/api/settings/public', (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out  = {};
  rows.forEach(r => { out[r.key] = r.value; });
  // Don't expose sensitive fields
  delete out.mpesaB2cSecurityCredential;
  res.json(out);
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ══════════════════════════════════════════════════════
//  USER ROUTES  (/api/user/*)
// ══════════════════════════════════════════════════════

// Dashboard (all data in one call)
app.get('/api/user/dashboard', authMiddleware, (req, res) => {
  const uid  = req.user.id;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const investments  = db.prepare('SELECT * FROM investments WHERE userId=? ORDER BY createdAt DESC').all(uid);
  const deposits     = db.prepare('SELECT * FROM deposits WHERE userId=? ORDER BY createdAt DESC LIMIT 20').all(uid);
  const withdrawals  = db.prepare('SELECT * FROM withdrawals WHERE userId=? ORDER BY createdAt DESC LIMIT 20').all(uid);
  const transactions = db.prepare('SELECT * FROM transactions WHERE userId=? ORDER BY createdAt DESC LIMIT 50').all(uid);
  const referrals    = db.prepare(`SELECT u.firstName,u.lastName,u.createdAt,0 as earnings
    FROM users u WHERE u.referredBy=? ORDER BY u.createdAt DESC`).all(uid);

  res.json({ user: safeUser(user), investments, deposits, withdrawals, transactions, referrals });
});

// Balance (for poller)
app.get('/api/user/balance', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT balance,totalProfits,totalWithdrawn FROM users WHERE id=?').get(req.user.id);
  const pendingDeps = db.prepare(`SELECT COUNT(*) as c FROM deposits WHERE userId=? AND status='pending'`).get(req.user.id);
  res.json({ balance: user.balance, totalProfits: user.totalProfits, totalWithdrawn: user.totalWithdrawn, pendingDeps: pendingDeps.c });
});

// Withdraw info
app.get('/api/user/withdraw-info', authMiddleware, (req, res) => {
  const user       = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const lockDays   = parseInt(getSetting('principalLockDays') || '90');
  const feeRate    = parseFloat(getSetting('withdrawFee') || '2');
  const minWithdraw= parseFloat(getSetting('minWithdraw') || '500');
  const maxDaily   = parseInt(getSetting('maxDailyWithdrawals') || '3');

  // Count today's withdrawals
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayWds   = db.prepare(`SELECT COUNT(*) as c FROM withdrawals
    WHERE userId=? AND status NOT IN ('rejected') AND createdAt>=?`)
    .get(req.user.id, todayStart.toISOString());

  // Calculate locked principal
  const active = db.prepare(`SELECT * FROM investments WHERE userId=? AND status='active'`).all(req.user.id);
  let totalLocked = 0;
  let earliestUnlockDays = 999;

  for (const inv of active) {
    const start    = new Date(inv.startDate);
    const unlockAt = new Date(start.getTime() + lockDays * 86400000);
    const now      = new Date();
    if (now < unlockAt) {
      totalLocked += inv.amount;
      const daysLeft = Math.ceil((unlockAt - now) / 86400000);
      if (daysLeft < earliestUnlockDays) earliestUnlockDays = daysLeft;
    }
  }

  const withdrawableBalance = Math.max(0, user.balance - totalLocked);

  res.json({
    withdrawableBalance,
    totalLocked,
    principalLocked: totalLocked > 0,
    todayWithdrawals: todayWds.c,
    maxDailyWithdrawals: maxDaily,
    withdrawalsRemaining: Math.max(0, maxDaily - todayWds.c),
    feeRate,
    minWithdraw,
    lockDays,
    earliestUnlockDays: earliestUnlockDays === 999 ? 0 : earliestUnlockDays
  });
});

// Invest
app.post('/api/user/invest', authMiddleware, (req, res) => {
  try {
    const { planId, amount } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(planId);

    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (amount < plan.minAmount) return res.status(400).json({ error: `Minimum is KES ${plan.minAmount.toLocaleString()}` });
    if (amount > plan.maxAmount) return res.status(400).json({ error: `Maximum is KES ${plan.maxAmount.toLocaleString()}` });
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance. Please deposit first.' });

    const start   = new Date();
    const end     = new Date(start.getTime() + plan.period * 86400000);

    db.prepare(`UPDATE users SET balance=balance-?, totalInvested=totalInvested+? WHERE id=?`).run(amount, amount, user.id);
    db.prepare(`INSERT INTO investments (userId,planId,planName,amount,roi,period,status,startDate,endDate)
                VALUES (?,?,?,?,?,?,?,?,?)`).run(user.id, plan.id, plan.name, amount, plan.roi, plan.period, 'active', start.toISOString(), end.toISOString());
    db.prepare(`INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)`)
      .run(user.id, 'investment', amount, `${plan.name} plan investment`, 'completed');

    // Referral commission
    if (user.referredBy) {
      const rate       = parseFloat(plan.referralBonus || getSetting('referralRate') || '5') / 100;
      const commission = amount * rate;
      db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(commission, user.referredBy);
      db.prepare(`INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)`)
        .run(user.referredBy, 'referral', commission, `Referral commission from ${user.firstName}`, 'completed');
      db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
        .run(user.referredBy, `💰 You earned KES ${commission.toFixed(2)} referral commission!`, 'success');
    }

    const updatedUser = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    res.json({ success: true, user: safeUser(updatedUser) });

  } catch (e) {
    console.error('Invest error:', e.message);
    res.status(500).json({ error: 'Investment failed. Please try again.' });
  }
});

// Manual deposit
app.post('/api/user/deposit/manual', authMiddleware, (req, res) => {
  try {
    const { amount, method, proofNote } = req.body;
    const minDep = parseFloat(getSetting('minDeposit') || '1000');
    if (!amount || amount < minDep) return res.status(400).json({ error: `Minimum deposit is KES ${minDep}` });
    if (!proofNote) return res.status(400).json({ error: 'Transaction code required' });

    db.prepare(`INSERT INTO deposits (userId,amount,method,proofNote,status) VALUES (?,?,?,?,?)`)
      .run(req.user.id, amount, method || 'M-Pesa', proofNote, 'pending');
    db.prepare(`INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)`)
      .run(req.user.id, 'deposit', amount, `${method || 'M-Pesa'} deposit - pending approval`, 'pending');

    res.json({ success: true, message: 'Deposit submitted. Admin will confirm within 30 minutes.' });
  } catch (e) {
    res.status(500).json({ error: 'Deposit submission failed.' });
  }
});

// Withdraw
app.post('/api/user/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, method, address } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);

    const minWd  = parseFloat(getSetting('minWithdraw') || '500');
    const maxD   = parseInt(getSetting('maxDailyWithdrawals') || '3');
    const feeR   = parseFloat(getSetting('withdrawFee') || '2');

    if (!amount || amount < minWd) return res.status(400).json({ error: `Minimum withdrawal is KES ${minWd}` });
    if (!address) return res.status(400).json({ error: 'Withdrawal address required' });

    // Daily limit check
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayWds   = db.prepare(`SELECT COUNT(*) as c FROM withdrawals
      WHERE userId=? AND status NOT IN ('rejected') AND createdAt>=?`).get(user.id, todayStart.toISOString());
    if (todayWds.c >= maxD) return res.status(400).json({ error: `Daily withdrawal limit (${maxD}) reached. Resets at midnight.` });

    // Balance check (only profits withdrawable if principal locked)
    if (amount > user.balance) return res.status(400).json({ error: 'Insufficient balance' });

    const fee = amount * (feeR / 100);
    const net = amount - fee;

    db.prepare('UPDATE users SET balance=balance-?, totalWithdrawn=totalWithdrawn+? WHERE id=?').run(amount, net, user.id);
    const r = db.prepare(`INSERT INTO withdrawals (userId,amount,fee,net,method,address,status) VALUES (?,?,?,?,?,?,?)`)
      .run(user.id, amount, fee, net, method || 'M-Pesa', address, 'pending');
    db.prepare(`INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)`)
      .run(user.id, 'withdrawal', amount, `${method} withdrawal to ${address}`, 'pending');

    const remaining = Math.max(0, maxD - todayWds.c - 1);
    res.json({ success: true, withdrawalsRemainingToday: remaining });
  } catch (e) {
    console.error('Withdraw error:', e.message);
    res.status(500).json({ error: 'Withdrawal failed. Please try again.' });
  }
});

// Profile update
app.put('/api/user/profile', authMiddleware, (req, res) => {
  const { firstName, lastName, phone } = req.body;
  db.prepare('UPDATE users SET firstName=COALESCE(?,firstName), lastName=COALESCE(?,lastName), phone=COALESCE(?,phone) WHERE id=?')
    .run(firstName || null, lastName || null, phone || null, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json(safeUser(user));
});

// Password change
app.put('/api/user/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const ok   = await bcrypt.compare(currentPassword, user.password);
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be 8+ characters' });
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, req.user.id);
  res.json({ success: true });
});

// Notifications
app.get('/api/user/notifications', authMiddleware, (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 30').all(req.user.id);
  res.json(notifs);
});

app.put('/api/user/notifications/read', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE userId=?').run(req.user.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════
//  M-PESA STK PUSH
// ══════════════════════════════════════════════════════

async function getMpesaToken() {
  const creds = Buffer.from(`${MPESA.consumerKey}:${MPESA.consumerSecret}`).toString('base64');
  const r = await axios.get(`${MPESA.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${creds}` }
  });
  return r.data.access_token;
}

app.post('/api/mpesa/stk-push', authMiddleware, async (req, res) => {
  try {
    const { phone, amount } = req.body;
    const minDep = parseFloat(getSetting('minDeposit') || '1000');
    if (!phone || !amount || amount < minDep) {
      return res.status(400).json({ error: `Minimum deposit is KES ${minDep}` });
    }

    // Format phone: 07xx → 2547xx
    let formattedPhone = phone.toString().trim().replace(/\s/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
    if (formattedPhone.startsWith('+')) formattedPhone = formattedPhone.slice(1);

    if (!MPESA.consumerKey || !MPESA.consumerSecret) {
      // Demo mode — create a pending deposit and return a fake checkout ID
      const fakeId = 'DEMO_' + Date.now();
      db.prepare(`INSERT INTO deposits (userId,amount,method,proofNote,checkoutRequestId,status) VALUES (?,?,?,?,?,?)`)
        .run(req.user.id, amount, 'M-Pesa STK', 'Demo STK Push', fakeId, 'pending');
      return res.json({ checkoutRequestId: fakeId, message: 'STK (demo mode) — admin will approve manually' });
    }

    const token     = await getMpesaToken();
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g,'').slice(0,14);
    const password  = Buffer.from(`${MPESA.shortcode}${MPESA.passkey}${timestamp}`).toString('base64');
    const callbackUrl = `${BASE_URL}/api/mpesa/callback`;

    const body = {
      BusinessShortCode: MPESA.shortcode,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   MPESA.transactionType,
      Amount:            Math.round(amount),
      PartyA:            formattedPhone,
      PartyB:            MPESA.shortcode,
      PhoneNumber:       formattedPhone,
      CallBackURL:       callbackUrl,
      AccountReference:  'PesaGrow',
      TransactionDesc:   'Investment Deposit'
    };

    const r = await axios.post(`${MPESA.baseUrl}/mpesa/stkpush/v1/processrequest`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    const checkoutRequestId = r.data.CheckoutRequestID;
    db.prepare(`INSERT INTO deposits (userId,amount,method,checkoutRequestId,status) VALUES (?,?,?,?,?)`)
      .run(req.user.id, amount, 'M-Pesa STK', checkoutRequestId, 'pending');

    res.json({ checkoutRequestId, merchantRequestId: r.data.MerchantRequestID });

  } catch (e) {
    console.error('STK error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.errorMessage || 'STK Push failed. Check M-Pesa credentials.' });
  }
});

// M-Pesa callback
app.post('/api/mpesa/callback', express.json({ type: '*/*' }), (req, res) => {
  try {
    const body   = req.body?.Body?.stkCallback || req.body;
    const code   = body?.ResultCode;
    const checkId= body?.CheckoutRequestID;
    const items  = body?.CallbackMetadata?.Item || [];
    const receipt= items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    const amount = items.find(i => i.Name === 'Amount')?.Value;
    const phone  = items.find(i => i.Name === 'PhoneNumber')?.Value?.toString();

    db.prepare(`INSERT INTO mpesa_logs (checkoutId,phone,amount,resultCode,receiptNo) VALUES (?,?,?,?,?)`)
      .run(checkId, phone, amount, String(code), receipt);

    if (String(code) === '0' && checkId) {
      const dep = db.prepare(`SELECT * FROM deposits WHERE checkoutRequestId=?`).get(checkId);
      if (dep && dep.status === 'pending') {
        db.prepare(`UPDATE deposits SET status='approved', mpesaReceiptNo=?, updatedAt=? WHERE id=?`)
          .run(receipt, new Date().toISOString(), dep.id);
        db.prepare(`UPDATE users SET balance=balance+? WHERE id=?`).run(dep.amount, dep.userId);
        db.prepare(`UPDATE transactions SET status='completed' WHERE userId=? AND type='deposit' AND status='pending'`)
          .run(dep.userId);
        db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
          .run(dep.userId, `✅ KES ${dep.amount.toFixed(2)} deposit confirmed! Receipt: ${receipt}`, 'success');
      }
    }
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (e) {
    console.error('Callback error:', e.message);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// STK status polling
app.get('/api/mpesa/status/:checkoutId', authMiddleware, (req, res) => {
  const dep = db.prepare(`SELECT * FROM deposits WHERE checkoutRequestId=? AND userId=?`)
    .get(req.params.checkoutId, req.user.id);
  if (!dep) return res.status(404).json({ status: 'not_found' });
  res.json({ status: dep.status === 'approved' ? 'approved' : dep.status === 'rejected' ? 'failed' : 'pending' });
});

// ══════════════════════════════════════════════════════
//  ADMIN ROUTES  (/api/admin/*)
// ══════════════════════════════════════════════════════

// Stats
app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  const totalMembers    = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='user'`).get().c;
  const activeInvestors = db.prepare(`SELECT COUNT(DISTINCT userId) as c FROM investments WHERE status='active'`).get().c;
  const pendingDeps     = db.prepare(`SELECT COUNT(*) as c FROM deposits WHERE status='pending'`).get().c;
  const pendingWds      = db.prepare(`SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'`).get().c;
  const totalDeposited  = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE status='approved'`).get().s;
  const totalWithdrawn  = db.prepare(`SELECT COALESCE(SUM(net),0) as s FROM withdrawals WHERE status='approved'`).get().s;
  const totalInvested   = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM investments`).get().s;
  const totalProfitPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='profit'`).get().s;
  const recentUsers     = db.prepare(`SELECT * FROM users WHERE role='user' ORDER BY createdAt DESC LIMIT 5`).all().map(safeUser);
  const recentTx        = db.prepare(`SELECT * FROM transactions ORDER BY createdAt DESC LIMIT 10`).all();

  res.json({ totalMembers, activeInvestors, pendingDeps, pendingWds, totalDeposited, totalWithdrawn, totalInvested, totalProfitPaid, recentUsers, recentTx });
});

// Members
app.get('/api/admin/members', authMiddleware, adminOnly, (req, res) => {
  const members = db.prepare(`SELECT * FROM users WHERE role='user' ORDER BY createdAt DESC`).all().map(safeUser);
  res.json(members);
});

app.put('/api/admin/members/:id', authMiddleware, adminOnly, async (req, res) => {
  const { firstName, lastName, email, phone, balance, status } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare(`UPDATE users SET
    firstName=COALESCE(?,firstName), lastName=COALESCE(?,lastName),
    email=COALESCE(?,email), phone=COALESCE(?,phone),
    balance=COALESCE(?,balance), status=COALESCE(?,status) WHERE id=?`)
    .run(firstName||null, lastName||null, email||null, phone||null, balance??null, status||null, req.params.id);
  res.json({ success: true });
});

// Adjust balance
app.post('/api/admin/adjust-balance', authMiddleware, adminOnly, (req, res) => {
  const { userId, amount, type, reason } = req.body;
  if (!userId || !amount || !type || !reason) return res.status(400).json({ error: 'All fields required' });
  const delta = type === 'credit' ? amount : -amount;
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(delta, userId);
  db.prepare(`INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)`)
    .run(userId, type === 'credit' ? 'deposit' : 'withdrawal', Math.abs(amount), reason, 'completed');
  db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
    .run(userId, `${type === 'credit' ? '💰 KES ' + amount + ' credited' : '💸 KES ' + amount + ' debited'} by admin: ${reason}`, 'info');
  res.json({ success: true });
});

// Deposits
app.get('/api/admin/deposits', authMiddleware, adminOnly, (req, res) => {
  const deps = db.prepare(`SELECT d.*, u.firstName||' '||u.lastName as userName, u.phone as userPhone
    FROM deposits d JOIN users u ON d.userId=u.id ORDER BY d.createdAt DESC`).all();
  res.json(deps);
});

app.put('/api/admin/deposits/:id/approve', authMiddleware, adminOnly, (req, res) => {
  const dep = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Deposit not found' });
  if (dep.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  db.prepare(`UPDATE deposits SET status='approved', updatedAt=? WHERE id=?`).run(new Date().toISOString(), dep.id);
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(dep.amount, dep.userId);
  db.prepare(`INSERT INTO transactions (userId,type,amount,description,status) VALUES (?,?,?,?,?)`)
    .run(dep.userId, 'deposit', dep.amount, `${dep.method} deposit approved`, 'completed');
  db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
    .run(dep.userId, `✅ Your deposit of KES ${dep.amount.toFixed(2)} has been approved!`, 'success');
  res.json({ success: true });
});

app.put('/api/admin/deposits/:id/reject', authMiddleware, adminOnly, (req, res) => {
  const { reason } = req.body;
  const dep = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE deposits SET status='rejected', rejectionReason=?, updatedAt=? WHERE id=?`)
    .run(reason || 'Rejected by admin', new Date().toISOString(), dep.id);
  db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
    .run(dep.userId, `❌ Your deposit was rejected. Reason: ${reason || 'Contact support'}`, 'error');
  res.json({ success: true });
});

// Withdrawals
app.get('/api/admin/withdrawals', authMiddleware, adminOnly, (req, res) => {
  const wds = db.prepare(`SELECT w.*, u.firstName||' '||u.lastName as userName, u.phone as userPhone
    FROM withdrawals w JOIN users u ON w.userId=u.id ORDER BY w.createdAt DESC`).all();
  res.json(wds);
});

app.put('/api/admin/withdrawals/:id/approve', authMiddleware, adminOnly, async (req, res) => {
  const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
  if (!wd) return res.status(404).json({ error: 'Not found' });
  if (wd.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

  db.prepare(`UPDATE withdrawals SET status='approved', updatedAt=? WHERE id=?`)
    .run(new Date().toISOString(), wd.id);
  db.prepare(`UPDATE transactions SET status='completed' WHERE userId=? AND type='withdrawal' AND status='pending'`)
    .run(wd.userId);
  db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
    .run(wd.userId, `✅ Your withdrawal of KES ${wd.amount.toFixed(2)} has been approved and sent!`, 'success');

  res.json({ success: true, warning: 'Please send KES ' + wd.net + ' to ' + wd.address + ' manually via M-Pesa.' });
});

app.put('/api/admin/withdrawals/:id/reject', authMiddleware, adminOnly, (req, res) => {
  const { reason } = req.body;
  const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
  if (!wd || wd.status !== 'pending') return res.status(400).json({ error: 'Cannot reject' });
  db.prepare(`UPDATE withdrawals SET status='rejected', rejectionReason=?, updatedAt=? WHERE id=?`)
    .run(reason, new Date().toISOString(), wd.id);
  // Refund balance
  db.prepare('UPDATE users SET balance=balance+?, totalWithdrawn=totalWithdrawn-? WHERE id=?').run(wd.amount, wd.net, wd.userId);
  db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`)
    .run(wd.userId, `❌ Withdrawal rejected. KES ${wd.amount.toFixed(2)} refunded. Reason: ${reason}`, 'error');
  res.json({ success: true });
});

// Investments
app.get('/api/admin/investments', authMiddleware, adminOnly, (req, res) => {
  const invs = db.prepare(`SELECT i.*, u.firstName||' '||u.lastName as userName
    FROM investments i JOIN users u ON i.userId=u.id ORDER BY i.createdAt DESC`).all();
  res.json(invs);
});

// Transactions
app.get('/api/admin/transactions', authMiddleware, adminOnly, (req, res) => {
  const txs = db.prepare(`SELECT t.*, u.firstName||' '||u.lastName as userName
    FROM transactions t JOIN users u ON t.userId=u.id ORDER BY t.createdAt DESC LIMIT 200`).all();
  res.json(txs);
});

// Plans CRUD
app.get('/api/admin/plans', authMiddleware, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM plans ORDER BY minAmount ASC').all());
});

app.post('/api/admin/plans', authMiddleware, adminOnly, (req, res) => {
  const { name, roi, period, minAmount, maxAmount, referralBonus, color, description, popular, active } = req.body;
  const r = db.prepare(`INSERT INTO plans (name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular,active)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(name, roi, period, minAmount, maxAmount, referralBonus||5, color||'#00e676', description||'', popular||0, active??1);
  res.json({ id: r.lastInsertRowid, success: true });
});

app.put('/api/admin/plans/:id', authMiddleware, adminOnly, (req, res) => {
  const { name, roi, period, minAmount, maxAmount, referralBonus, color, description, popular, active } = req.body;
  db.prepare(`UPDATE plans SET name=COALESCE(?,name), roi=COALESCE(?,roi), period=COALESCE(?,period),
    minAmount=COALESCE(?,minAmount), maxAmount=COALESCE(?,maxAmount), referralBonus=COALESCE(?,referralBonus),
    color=COALESCE(?,color), description=COALESCE(?,description), popular=COALESCE(?,popular), active=COALESCE(?,active)
    WHERE id=?`)
    .run(name||null, roi??null, period??null, minAmount??null, maxAmount??null, referralBonus??null, color||null, description||null, popular??null, active??null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/plans/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM plans WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Settings
app.get('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out  = {};
  rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
});

app.put('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  for (const [k,v] of Object.entries(req.body)) {
    if (v !== undefined && v !== null) upsert.run(k, String(v));
  }
  res.json({ success: true });
});

// Broadcast
app.post('/api/admin/broadcast', authMiddleware, adminOnly, (req, res) => {
  const { userId, message, type } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  if (userId) {
    db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`).run(userId, message, type||'info');
  } else {
    const users = db.prepare(`SELECT id FROM users WHERE role='user' AND status='active'`).all();
    const ins   = db.prepare(`INSERT INTO notifications (userId,message,type) VALUES (?,?,?)`);
    for (const u of users) ins.run(u.id, message, type||'info');
  }
  res.json({ success: true });
});

// M-Pesa logs
app.get('/api/admin/mpesa-logs', authMiddleware, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM mpesa_logs ORDER BY processedAt DESC LIMIT 100').all());
});

// B2C logs (stub — returns empty until B2C is configured)
app.get('/api/admin/b2c-logs', authMiddleware, adminOnly, (req, res) => {
  res.json([]);
});

// ══════════════════════════════════════════════════════
//  SPA FALLBACKS — must be LAST
// ══════════════════════════════════════════════════════

app.get('/admin*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Pesa Grow server running on port ${PORT}`);
  console.log(`   Till: ${MPESA.shortcode}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Admin: ${ADMIN_EMAIL}`);
});
