/**
 * ============================================================
 *  PESA GROW — server.js  (Railway-ready, zero native deps)
 *  Till Number: 5321672
 * ============================================================
 *  Dependencies: express, cors, dotenv, bcryptjs, jsonwebtoken,
 *                sql.js (pure-JS SQLite), axios, multer
 *  NO native addons — builds on Railway Node 22 without Python
 * ============================================================
 */

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const axios     = require('axios');
const multer    = require('multer');
const initSqlJs = require('sql.js');

// ── Uploads dir ────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Constants ──────────────────────────────────────────────
const PORT        = process.env.PORT        || 3000;
const JWT_SECRET  = process.env.JWT_SECRET  || 'pesagrow-secret-2024-change-me';
const BASE_URL    = process.env.BASE_URL    || `http://localhost:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@pesagrow.co.ke';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'Admin@2024';

// ── M-Pesa config ──────────────────────────────────────────
const MPESA = {
  env:             process.env.MPESA_ENV             || 'sandbox',
  consumerKey:     process.env.MPESA_CONSUMER_KEY    || '',
  consumerSecret:  process.env.MPESA_CONSUMER_SECRET || '',
  shortcode:       process.env.MPESA_SHORTCODE        || '5321672',
  passkey:         process.env.MPESA_PASSKEY          || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  transactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline',
  get baseUrl() {
    return this.env === 'live'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
  }
};

// ══════════════════════════════════════════════════════
//  sql.js WRAPPER  — mimics better-sqlite3 sync API
//  sql.js is in-memory; we persist to a JSON file on disk
// ══════════════════════════════════════════════════════
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'pesagrow.db.json');

let SQL;   // sql.js module
let db;    // sql.js Database instance
let saveTimer = null;

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const data = db.export();           // Uint8Array
      fs.writeFileSync(DB_FILE + '.bin', Buffer.from(data));
    } catch (e) { console.error('DB save error:', e.message); }
  }, 500);
}

// Thin helpers that look like better-sqlite3
function run(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
  return db;
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

function all(sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function exec(sql) {
  db.run(sql);
  scheduleSave();
}

// ── Helpers ────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10) +
         Math.random().toString(36).slice(2, 10);
}

function nowISO() { return new Date().toISOString(); }

function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key=?', [key]);
  return row ? row.value : null;
}

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

function safeUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  // sql.js returns numbers as numbers — coerce balance fields
  ['balance','totalInvested','totalProfits','totalWithdrawn'].forEach(f => {
    if (safe[f] !== undefined) safe[f] = Number(safe[f]) || 0;
  });
  return safe;
}

function genRefCode() {
  return 'PG' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ── Auth middleware ────────────────────────────────────────
function authMiddleware(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr || !hdr.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(hdr.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });
  next();
}

// ══════════════════════════════════════════════════════
//  BOOT — init sql.js then start express
// ══════════════════════════════════════════════════════
async function boot() {
  SQL = await initSqlJs();

  // Load existing DB from disk if available
  const binFile = DB_FILE + '.bin';
  if (fs.existsSync(binFile)) {
    const buf = fs.readFileSync(binFile);
    db = new SQL.Database(buf);
    console.log('✅ Loaded existing database from disk');
  } else {
    db = new SQL.Database();
    console.log('✅ Created fresh database');
  }

  // ── Schema ──────────────────────────────────────────
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
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
      createdAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id            TEXT PRIMARY KEY,
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
      createdAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investments (
      id            TEXT PRIMARY KEY,
      userId        TEXT NOT NULL,
      planId        TEXT NOT NULL,
      planName      TEXT NOT NULL,
      amount        REAL NOT NULL,
      roi           REAL NOT NULL,
      period        INTEGER NOT NULL,
      earned        REAL NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'active',
      startDate     TEXT NOT NULL,
      endDate       TEXT NOT NULL,
      lastCredited  TEXT,
      createdAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id                TEXT PRIMARY KEY,
      userId            TEXT NOT NULL,
      amount            REAL NOT NULL,
      method            TEXT NOT NULL DEFAULT 'M-Pesa',
      proofNote         TEXT,
      mpesaReceiptNo    TEXT,
      checkoutRequestId TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      rejectionReason   TEXT,
      createdAt         TEXT NOT NULL,
      updatedAt         TEXT
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id              TEXT PRIMARY KEY,
      userId          TEXT NOT NULL,
      amount          REAL NOT NULL,
      fee             REAL NOT NULL DEFAULT 0,
      net             REAL NOT NULL,
      method          TEXT NOT NULL DEFAULT 'M-Pesa',
      address         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      rejectionReason TEXT,
      b2cTransactionId TEXT,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          TEXT PRIMARY KEY,
      userId      TEXT NOT NULL,
      type        TEXT NOT NULL,
      amount      REAL NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'completed',
      createdAt   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      message   TEXT NOT NULL,
      type      TEXT DEFAULT 'info',
      read      INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mpesa_logs (
      id          TEXT PRIMARY KEY,
      checkoutId  TEXT,
      phone       TEXT,
      amount      REAL,
      resultCode  TEXT,
      receiptNo   TEXT,
      processedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // ── Seed default plans ─────────────────────────────
  const planCount = get('SELECT COUNT(*) as c FROM plans');
  if (!planCount || Number(planCount.c) === 0) {
    const plans = [
      [uid(),'Starter', 3,  7,  1000,   9999,   5,  '#00e5ff', 'Perfect entry plan',         0, 1],
      [uid(),'Silver',  5,  14, 10000,  49999,  5,  '#b0b0b0', 'Balanced growth plan',       0, 1],
      [uid(),'Gold',    7,  21, 50000,  199999, 7,  '#ffc107', 'High-performance plan',      1, 1],
      [uid(),'Platinum',10, 30, 200000, 9999999,10, '#b388ff', 'Dedicated manager included', 0, 1],
    ];
    for (const p of plans) {
      run(`INSERT OR IGNORE INTO plans
           (id,name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular,active,createdAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [...p, nowISO()]);
    }
  }

  // ── Seed settings ──────────────────────────────────
  const defaults = {
    siteName:'Pesa Grow', sitePhone:'0796820013',
    siteEmail:'support@pesagrow.co.ke',
    mpesaTill:'5321672', mpesaName:'PESA GROW LTD',
    minDeposit:'1000', minWithdraw:'500',
    withdrawFee:'2', referralRate:'5',
    welcomeBonus:'0', minHoldingDays:'3',
    principalLockDays:'90', maxDailyWithdrawals:'3'
  };
  for (const [k,v] of Object.entries(defaults)) {
    run('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', [k, v]);
  }

  // ── Seed admin ─────────────────────────────────────
  const adminRow = get("SELECT id FROM users WHERE role='admin'");
  if (!adminRow) {
    const hash = bcrypt.hashSync(ADMIN_PASS, 10);
    run(`INSERT OR IGNORE INTO users
         (id,firstName,lastName,email,phone,password,role,refCode,balance,
          totalInvested,totalProfits,totalWithdrawn,createdAt)
         VALUES (?,?,?,?,?,?,?,?,0,0,0,0,?)`,
      [uid(),'Admin','User',ADMIN_EMAIL,'0796820013',hash,'admin','ADMIN001',nowISO()]);
  }

  // ── Profit accrual every 60s ───────────────────────
  setInterval(accrueProfit, 60000);

  // ── Start Express ──────────────────────────────────
  startExpress();
}

// ── Profit accrual ────────────────────────────────────────
function accrueProfit() {
  const active = all(`SELECT * FROM investments WHERE status='active'`);
  for (const inv of active) {
    const now  = new Date();
    const end  = new Date(inv.endDate);

    if (now >= end) {
      // Matured
      const totalProfit = Number(inv.amount) * Number(inv.roi) / 100 * Number(inv.period);
      const remaining   = totalProfit - Number(inv.earned);
      run(`UPDATE investments SET earned=?, lastCredited=?, status='completed' WHERE id=?`,
        [totalProfit, nowISO(), inv.id]);
      if (remaining > 0) {
        run(`UPDATE users SET balance=balance+?, totalProfits=totalProfits+? WHERE id=?`,
          [remaining, remaining, inv.userId]);
        run(`INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
          [uid(), inv.userId, 'profit', totalProfit, `${inv.planName} plan completed`, 'completed', nowISO()]);
        run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
          [uid(), inv.userId, `🎉 Your ${inv.planName} investment matured! KES ${totalProfit.toFixed(2)} credited.`, 'success', nowISO()]);
      }
    } else {
      // Ongoing — credit hourly
      const lastCredit = inv.lastCredited ? new Date(inv.lastCredited) : new Date(inv.startDate);
      const hoursElapsed = (now - lastCredit) / 3600000;
      if (hoursElapsed < 1) continue;
      const dailyRoi    = Number(inv.amount) * Number(inv.roi) / 100;
      const hoursProfit = dailyRoi / 24 * hoursElapsed;
      run(`UPDATE investments SET earned=earned+?, lastCredited=? WHERE id=?`,
        [hoursProfit, nowISO(), inv.id]);
      run(`UPDATE users SET balance=balance+?, totalProfits=totalProfits+? WHERE id=?`,
        [hoursProfit, hoursProfit, inv.userId]);
    }
  }
}

// ══════════════════════════════════════════════════════
//  EXPRESS APP
// ══════════════════════════════════════════════════════
function startExpress() {
  const app    = express();
  const upload = multer({ dest: UPLOADS_DIR });

  app.use(cors({ origin: '*' }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Health ─────────────────────────────────────────
  app.get('/api/health', (_, res) => res.json({ ok: true, ts: nowISO() }));

  // ── Public plans ───────────────────────────────────
  app.get('/api/plans', (_, res) => {
    res.json(all('SELECT * FROM plans WHERE active=1 ORDER BY minAmount ASC'));
  });

  // ── Public settings ────────────────────────────────
  app.get('/api/settings/public', (_, res) => {
    const rows = all('SELECT key,value FROM settings');
    const out  = {};
    rows.forEach(r => { out[r.key] = r.value; });
    delete out.mpesaB2cSecurityCredential;
    res.json(out);
  });

  // ════════════════════════════════════════════════════
  //  AUTH
  // ════════════════════════════════════════════════════

  // REGISTER
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { firstName, lastName, email, phone, password, refCode } = req.body;
      if (!firstName || !lastName || !email || !phone || !password)
        return res.status(400).json({ error: 'All fields are required' });
      if (password.length < 8)
        return res.status(400).json({ error: 'Password must be at least 8 characters' });

      const existing = get('SELECT id FROM users WHERE email=?', [email.toLowerCase().trim()]);
      if (existing) return res.status(409).json({ error: 'Email already registered' });

      const hash         = await bcrypt.hash(password, 10);
      const newCode      = genRefCode();
      const welcomeBonus = parseFloat(getSetting('welcomeBonus') || '0');
      const id           = uid();

      let referredBy = null;
      if (refCode) {
        const ref = get('SELECT id FROM users WHERE refCode=?', [refCode.toUpperCase()]);
        if (ref) referredBy = ref.id;
      }

      run(`INSERT INTO users
           (id,firstName,lastName,email,phone,password,role,status,kycStatus,
            refCode,referredBy,balance,totalInvested,totalProfits,totalWithdrawn,createdAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)`,
        [id, firstName.trim(), lastName.trim(), email.toLowerCase().trim(),
         phone.trim(), hash, 'user', 'active', 'none',
         newCode, referredBy, welcomeBonus, nowISO()]);

      if (welcomeBonus > 0) {
        run(`INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
          [uid(), id, 'bonus', welcomeBonus, 'Welcome bonus', 'completed', nowISO()]);
        run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
          [uid(), id, `🎉 Welcome! KES ${welcomeBonus} bonus credited.`, 'success', nowISO()]);
      }

      if (referredBy) {
        run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
          [uid(), referredBy, '👥 Someone joined using your referral code!', 'info', nowISO()]);
      }

      const user  = get('SELECT * FROM users WHERE id=?', [id]);
      const token = makeToken(user);
      res.json({ token, user: safeUser(user) });

    } catch (e) {
      console.error('Register error:', e.message);
      if (e.message && e.message.includes('UNIQUE'))
        return res.status(409).json({ error: 'Email already registered' });
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  });

  // LOGIN
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ error: 'Email and password required' });

      const user = get('SELECT * FROM users WHERE email=?', [email.toLowerCase().trim()]);
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });
      if (user.status === 'suspended')
        return res.status(403).json({ error: 'Account suspended. Contact support.' });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ error: 'Invalid email or password' });

      run('UPDATE users SET lastLogin=? WHERE id=?', [nowISO(), user.id]);
      const token = makeToken(user);
      res.json({ token, user: safeUser(user) });

    } catch (e) {
      console.error('Login error:', e.message);
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  });

  // ME
  app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = get('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(safeUser(user));
  });

  // ════════════════════════════════════════════════════
  //  USER
  // ════════════════════════════════════════════════════

  // Dashboard
  app.get('/api/user/dashboard', authMiddleware, (req, res) => {
    const uid2 = req.user.id;
    const user = get('SELECT * FROM users WHERE id=?', [uid2]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const investments  = all('SELECT * FROM investments WHERE userId=? ORDER BY createdAt DESC', [uid2]);
    const deposits     = all('SELECT * FROM deposits WHERE userId=? ORDER BY createdAt DESC LIMIT 20', [uid2]);
    const withdrawals  = all('SELECT * FROM withdrawals WHERE userId=? ORDER BY createdAt DESC LIMIT 20', [uid2]);
    const transactions = all('SELECT * FROM transactions WHERE userId=? ORDER BY createdAt DESC LIMIT 50', [uid2]);
    const referrals    = all(`SELECT firstName,lastName,createdAt FROM users WHERE referredBy=? ORDER BY createdAt DESC`, [uid2]);

    res.json({ user: safeUser(user), investments, deposits, withdrawals, transactions, referrals });
  });

  // Balance (for poller)
  app.get('/api/user/balance', authMiddleware, (req, res) => {
    const u  = get('SELECT balance,totalProfits,totalWithdrawn FROM users WHERE id=?', [req.user.id]);
    const pd = get(`SELECT COUNT(*) as c FROM deposits WHERE userId=? AND status='pending'`, [req.user.id]);
    res.json({
      balance:        Number(u.balance),
      totalProfits:   Number(u.totalProfits),
      totalWithdrawn: Number(u.totalWithdrawn),
      pendingDeps:    Number(pd.c)
    });
  });

  // Withdraw info
  app.get('/api/user/withdraw-info', authMiddleware, (req, res) => {
    const user      = get('SELECT * FROM users WHERE id=?', [req.user.id]);
    const lockDays  = parseInt(getSetting('principalLockDays') || '90');
    const feeRate   = parseFloat(getSetting('withdrawFee') || '2');
    const minWd     = parseFloat(getSetting('minWithdraw') || '500');
    const maxDaily  = parseInt(getSetting('maxDailyWithdrawals') || '3');

    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayWds   = get(
      `SELECT COUNT(*) as c FROM withdrawals WHERE userId=? AND status NOT IN ('rejected') AND createdAt>=?`,
      [req.user.id, todayStart.toISOString()]
    );

    const active = all(`SELECT * FROM investments WHERE userId=? AND status='active'`, [req.user.id]);
    let totalLocked = 0, earliestUnlock = 999;
    for (const inv of active) {
      const unlockAt = new Date(new Date(inv.startDate).getTime() + lockDays * 86400000);
      if (new Date() < unlockAt) {
        totalLocked += Number(inv.amount);
        const d = Math.ceil((unlockAt - new Date()) / 86400000);
        if (d < earliestUnlock) earliestUnlock = d;
      }
    }

    const withdrawable = Math.max(0, Number(user.balance) - totalLocked);
    const todayCount   = Number(todayWds.c);
    res.json({
      withdrawableBalance:   withdrawable,
      totalLocked,
      principalLocked:       totalLocked > 0,
      todayWithdrawals:      todayCount,
      maxDailyWithdrawals:   maxDaily,
      withdrawalsRemaining:  Math.max(0, maxDaily - todayCount),
      feeRate, minWithdraw: minWd, lockDays,
      earliestUnlockDays: earliestUnlock === 999 ? 0 : earliestUnlock
    });
  });

  // Invest
  app.post('/api/user/invest', authMiddleware, (req, res) => {
    try {
      const { planId, amount } = req.body;
      const user = get('SELECT * FROM users WHERE id=?', [req.user.id]);
      const plan = get('SELECT * FROM plans WHERE id=? AND active=1', [planId]);

      if (!plan) return res.status(404).json({ error: 'Plan not found' });
      if (amount < Number(plan.minAmount))
        return res.status(400).json({ error: `Minimum is KES ${Number(plan.minAmount).toLocaleString()}` });
      if (amount > Number(plan.maxAmount))
        return res.status(400).json({ error: `Maximum is KES ${Number(plan.maxAmount).toLocaleString()}` });
      if (Number(user.balance) < amount)
        return res.status(400).json({ error: 'Insufficient balance. Please deposit first.' });

      const start = nowISO();
      const end   = new Date(Date.now() + Number(plan.period) * 86400000).toISOString();
      const invId = uid();

      run(`UPDATE users SET balance=balance-?, totalInvested=totalInvested+? WHERE id=?`,
        [amount, amount, user.id]);
      run(`INSERT INTO investments (id,userId,planId,planName,amount,roi,period,status,startDate,endDate,createdAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [invId, user.id, plan.id, plan.name, amount, plan.roi, plan.period, 'active', start, end, nowISO()]);
      run(`INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
        [uid(), user.id, 'investment', amount, `${plan.name} plan investment`, 'completed', nowISO()]);

      // Referral commission
      if (user.referredBy) {
        const rate       = Number(plan.referralBonus || getSetting('referralRate') || 5) / 100;
        const commission = amount * rate;
        run('UPDATE users SET balance=balance+? WHERE id=?', [commission, user.referredBy]);
        run(`INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
          [uid(), user.referredBy, 'referral', commission, `Commission from ${user.firstName}`, 'completed', nowISO()]);
        run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
          [uid(), user.referredBy, `💰 You earned KES ${commission.toFixed(2)} referral commission!`, 'success', nowISO()]);
      }

      const updated = get('SELECT * FROM users WHERE id=?', [user.id]);
      res.json({ success: true, user: safeUser(updated) });
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
      if (!amount || amount < minDep)
        return res.status(400).json({ error: `Minimum deposit is KES ${minDep}` });
      if (!proofNote)
        return res.status(400).json({ error: 'M-Pesa transaction code required' });

      run(`INSERT INTO deposits (id,userId,amount,method,proofNote,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
        [uid(), req.user.id, amount, method || 'M-Pesa', proofNote, 'pending', nowISO()]);
      run(`INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
        [uid(), req.user.id, 'deposit', amount, `${method || 'M-Pesa'} deposit - pending`, 'pending', nowISO()]);

      res.json({ success: true, message: 'Deposit submitted. Admin confirms within 30 minutes.' });
    } catch (e) {
      res.status(500).json({ error: 'Deposit submission failed.' });
    }
  });

  // Withdraw
  app.post('/api/user/withdraw', authMiddleware, (req, res) => {
    try {
      const { amount, method, address } = req.body;
      const user   = get('SELECT * FROM users WHERE id=?', [req.user.id]);
      const minWd  = parseFloat(getSetting('minWithdraw') || '500');
      const maxD   = parseInt(getSetting('maxDailyWithdrawals') || '3');
      const feeR   = parseFloat(getSetting('withdrawFee') || '2');

      if (!amount || amount < minWd)
        return res.status(400).json({ error: `Minimum withdrawal is KES ${minWd}` });
      if (!address)
        return res.status(400).json({ error: 'Withdrawal address required' });

      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayWds   = get(
        `SELECT COUNT(*) as c FROM withdrawals WHERE userId=? AND status NOT IN ('rejected') AND createdAt>=?`,
        [user.id, todayStart.toISOString()]
      );
      if (Number(todayWds.c) >= maxD)
        return res.status(400).json({ error: `Daily limit (${maxD}) reached. Resets at midnight.` });

      if (amount > Number(user.balance))
        return res.status(400).json({ error: 'Insufficient balance' });

      const fee = amount * (feeR / 100);
      const net = amount - fee;

      run('UPDATE users SET balance=balance-?, totalWithdrawn=totalWithdrawn+? WHERE id=?',
        [amount, net, user.id]);
      run(`INSERT INTO withdrawals (id,userId,amount,fee,net,method,address,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?)`,
        [uid(), user.id, amount, fee, net, method || 'M-Pesa', address, 'pending', nowISO()]);
      run(`INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
        [uid(), user.id, 'withdrawal', amount, `${method} withdrawal to ${address}`, 'pending', nowISO()]);

      const remaining = Math.max(0, maxD - Number(todayWds.c) - 1);
      res.json({ success: true, withdrawalsRemainingToday: remaining });
    } catch (e) {
      console.error('Withdraw error:', e.message);
      res.status(500).json({ error: 'Withdrawal failed. Please try again.' });
    }
  });

  // Profile update
  app.put('/api/user/profile', authMiddleware, (req, res) => {
    const { firstName, lastName, phone } = req.body;
    run(`UPDATE users SET
         firstName=COALESCE(?,firstName),
         lastName=COALESCE(?,lastName),
         phone=COALESCE(?,phone)
         WHERE id=?`,
      [firstName || null, lastName || null, phone || null, req.user.id]);
    res.json(safeUser(get('SELECT * FROM users WHERE id=?', [req.user.id])));
  });

  // Password change
  app.put('/api/user/password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = get('SELECT * FROM users WHERE id=?', [req.user.id]);
    const ok   = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'New password must be 8+ characters' });
    run('UPDATE users SET password=? WHERE id=?', [await bcrypt.hash(newPassword, 10), req.user.id]);
    res.json({ success: true });
  });

  // Notifications
  app.get('/api/user/notifications', authMiddleware, (req, res) => {
    res.json(all('SELECT * FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 30', [req.user.id]));
  });

  app.put('/api/user/notifications/read', authMiddleware, (req, res) => {
    run('UPDATE notifications SET read=1 WHERE userId=?', [req.user.id]);
    res.json({ success: true });
  });

  // ════════════════════════════════════════════════════
  //  M-PESA STK PUSH
  // ════════════════════════════════════════════════════

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
      if (!phone || !amount || amount < minDep)
        return res.status(400).json({ error: `Minimum deposit is KES ${minDep}` });

      let fp = phone.toString().trim().replace(/\s/g, '');
      if (fp.startsWith('0'))  fp = '254' + fp.slice(1);
      if (fp.startsWith('+'))  fp = fp.slice(1);

      if (!MPESA.consumerKey || !MPESA.consumerSecret) {
        // Demo mode
        const fakeId = 'DEMO_' + Date.now();
        run(`INSERT INTO deposits (id,userId,amount,method,proofNote,checkoutRequestId,status,createdAt)
             VALUES (?,?,?,?,?,?,?,?)`,
          [uid(), req.user.id, amount, 'M-Pesa STK', 'Demo mode', fakeId, 'pending', nowISO()]);
        return res.json({ checkoutRequestId: fakeId, demo: true });
      }

      const token     = await getMpesaToken();
      const timestamp = new Date().toISOString().replace(/[-T:.Z]/g,'').slice(0,14);
      const password  = Buffer.from(`${MPESA.shortcode}${MPESA.passkey}${timestamp}`).toString('base64');

      const r = await axios.post(`${MPESA.baseUrl}/mpesa/stkpush/v1/processrequest`, {
        BusinessShortCode: MPESA.shortcode,
        Password:          password,
        Timestamp:         timestamp,
        TransactionType:   MPESA.transactionType,
        Amount:            Math.round(amount),
        PartyA:            fp,
        PartyB:            MPESA.shortcode,
        PhoneNumber:       fp,
        CallBackURL:       `${BASE_URL}/api/mpesa/callback`,
        AccountReference:  'PesaGrow',
        TransactionDesc:   'Investment Deposit'
      }, { headers: { Authorization: `Bearer ${token}` } });

      const checkoutRequestId = r.data.CheckoutRequestID;
      run(`INSERT INTO deposits (id,userId,amount,method,checkoutRequestId,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
        [uid(), req.user.id, amount, 'M-Pesa STK', checkoutRequestId, 'pending', nowISO()]);
      res.json({ checkoutRequestId });

    } catch (e) {
      console.error('STK error:', e.response?.data || e.message);
      res.status(500).json({ error: e.response?.data?.errorMessage || 'STK Push failed.' });
    }
  });

  app.post('/api/mpesa/callback', express.json({ type: '*/*' }), (req, res) => {
    try {
      const body   = req.body?.Body?.stkCallback || req.body;
      const code   = String(body?.ResultCode);
      const checkId= body?.CheckoutRequestID;
      const items  = body?.CallbackMetadata?.Item || [];
      const receipt= items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const amount = items.find(i => i.Name === 'Amount')?.Value;
      const phone  = String(items.find(i => i.Name === 'PhoneNumber')?.Value || '');

      run(`INSERT INTO mpesa_logs (id,checkoutId,phone,amount,resultCode,receiptNo,processedAt) VALUES (?,?,?,?,?,?,?)`,
        [uid(), checkId, phone, amount, code, receipt, nowISO()]);

      if (code === '0' && checkId) {
        const dep = get(`SELECT * FROM deposits WHERE checkoutRequestId=?`, [checkId]);
        if (dep && dep.status === 'pending') {
          run(`UPDATE deposits SET status='approved', mpesaReceiptNo=?, updatedAt=? WHERE id=?`,
            [receipt, nowISO(), dep.id]);
          run(`UPDATE users SET balance=balance+? WHERE id=?`, [Number(dep.amount), dep.userId]);
          run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
            [uid(), dep.userId, `✅ KES ${Number(dep.amount).toFixed(2)} deposit confirmed! Receipt: ${receipt}`, 'success', nowISO()]);
        }
      }
      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (e) {
      console.error('Callback error:', e.message);
      res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
  });

  app.get('/api/mpesa/status/:checkoutId', authMiddleware, (req, res) => {
    const dep = get(`SELECT status FROM deposits WHERE checkoutRequestId=? AND userId=?`,
      [req.params.checkoutId, req.user.id]);
    if (!dep) return res.status(404).json({ status: 'not_found' });
    const mapped = dep.status === 'approved' ? 'approved'
                 : dep.status === 'rejected' ? 'failed' : 'pending';
    res.json({ status: mapped });
  });

  // ════════════════════════════════════════════════════
  //  ADMIN
  // ════════════════════════════════════════════════════

  // Stats
  app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
    res.json({
      totalMembers:    Number(get(`SELECT COUNT(*) as c FROM users WHERE role='user'`).c),
      activeInvestors: Number(get(`SELECT COUNT(DISTINCT userId) as c FROM investments WHERE status='active'`).c),
      pendingDeps:     Number(get(`SELECT COUNT(*) as c FROM deposits WHERE status='pending'`).c),
      pendingWds:      Number(get(`SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'`).c),
      totalDeposited:  Number(get(`SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE status='approved'`).s),
      totalWithdrawn:  Number(get(`SELECT COALESCE(SUM(net),0) as s FROM withdrawals WHERE status='approved'`).s),
      totalInvested:   Number(get(`SELECT COALESCE(SUM(amount),0) as s FROM investments`).s),
      totalProfitPaid: Number(get(`SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='profit'`).s),
      recentUsers: all(`SELECT * FROM users WHERE role='user' ORDER BY createdAt DESC LIMIT 5`).map(safeUser),
      recentTx:    all(`SELECT * FROM transactions ORDER BY createdAt DESC LIMIT 10`)
    });
  });

  // Members
  app.get('/api/admin/members', authMiddleware, adminOnly, (req, res) => {
    res.json(all(`SELECT * FROM users WHERE role='user' ORDER BY createdAt DESC`).map(safeUser));
  });

  app.put('/api/admin/members/:id', authMiddleware, adminOnly, (req, res) => {
    const { firstName, lastName, email, phone, balance, status } = req.body;
    run(`UPDATE users SET
         firstName=COALESCE(?,firstName), lastName=COALESCE(?,lastName),
         email=COALESCE(?,email),         phone=COALESCE(?,phone),
         balance=COALESCE(?,balance),     status=COALESCE(?,status)
         WHERE id=?`,
      [firstName||null, lastName||null, email||null, phone||null,
       balance??null, status||null, req.params.id]);
    res.json({ success: true });
  });

  // Adjust balance
  app.post('/api/admin/adjust-balance', authMiddleware, adminOnly, (req, res) => {
    const { userId, amount, type, reason } = req.body;
    if (!userId || !amount || !type || !reason)
      return res.status(400).json({ error: 'All fields required' });
    const delta = type === 'credit' ? amount : -amount;
    run('UPDATE users SET balance=balance+? WHERE id=?', [delta, userId]);
    run(`INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
      [uid(), userId, type === 'credit' ? 'deposit' : 'withdrawal', Math.abs(amount), reason, 'completed', nowISO()]);
    run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
      [uid(), userId, `${type === 'credit' ? '💰 KES ' + amount + ' credited' : '💸 KES ' + amount + ' debited'}: ${reason}`, 'info', nowISO()]);
    res.json({ success: true });
  });

  // Deposits
  app.get('/api/admin/deposits', authMiddleware, adminOnly, (req, res) => {
    res.json(all(`SELECT d.*, u.firstName||' '||u.lastName as userName, u.phone as userPhone
                  FROM deposits d JOIN users u ON d.userId=u.id ORDER BY d.createdAt DESC`));
  });

  app.put('/api/admin/deposits/:id/approve', authMiddleware, adminOnly, (req, res) => {
    const dep = get('SELECT * FROM deposits WHERE id=?', [req.params.id]);
    if (!dep) return res.status(404).json({ error: 'Not found' });
    if (dep.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    run(`UPDATE deposits SET status='approved', updatedAt=? WHERE id=?`, [nowISO(), dep.id]);
    run('UPDATE users SET balance=balance+? WHERE id=?', [Number(dep.amount), dep.userId]);
    run(`INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)`,
      [uid(), dep.userId, 'deposit', Number(dep.amount), `${dep.method} deposit approved`, 'completed', nowISO()]);
    run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
      [uid(), dep.userId, `✅ Your deposit of KES ${Number(dep.amount).toFixed(2)} has been approved!`, 'success', nowISO()]);
    res.json({ success: true });
  });

  app.put('/api/admin/deposits/:id/reject', authMiddleware, adminOnly, (req, res) => {
    const { reason } = req.body;
    const dep = get('SELECT * FROM deposits WHERE id=?', [req.params.id]);
    if (!dep) return res.status(404).json({ error: 'Not found' });
    run(`UPDATE deposits SET status='rejected', rejectionReason=?, updatedAt=? WHERE id=?`,
      [reason || 'Rejected by admin', nowISO(), dep.id]);
    run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
      [uid(), dep.userId, `❌ Deposit rejected. Reason: ${reason || 'Contact support'}`, 'error', nowISO()]);
    res.json({ success: true });
  });

  // Withdrawals
  app.get('/api/admin/withdrawals', authMiddleware, adminOnly, (req, res) => {
    res.json(all(`SELECT w.*, u.firstName||' '||u.lastName as userName, u.phone as userPhone
                  FROM withdrawals w JOIN users u ON w.userId=u.id ORDER BY w.createdAt DESC`));
  });

  app.put('/api/admin/withdrawals/:id/approve', authMiddleware, adminOnly, (req, res) => {
    const wd = get('SELECT * FROM withdrawals WHERE id=?', [req.params.id]);
    if (!wd || wd.status !== 'pending') return res.status(400).json({ error: 'Cannot approve' });
    run(`UPDATE withdrawals SET status='approved', updatedAt=? WHERE id=?`, [nowISO(), wd.id]);
    run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
      [uid(), wd.userId, `✅ Withdrawal of KES ${Number(wd.amount).toFixed(2)} approved and sent!`, 'success', nowISO()]);
    res.json({ success: true, warning: `Send KES ${wd.net} to ${wd.address} manually via M-Pesa.` });
  });

  app.put('/api/admin/withdrawals/:id/reject', authMiddleware, adminOnly, (req, res) => {
    const { reason } = req.body;
    const wd = get('SELECT * FROM withdrawals WHERE id=?', [req.params.id]);
    if (!wd || wd.status !== 'pending') return res.status(400).json({ error: 'Cannot reject' });
    run(`UPDATE withdrawals SET status='rejected', rejectionReason=?, updatedAt=? WHERE id=?`,
      [reason, nowISO(), wd.id]);
    run('UPDATE users SET balance=balance+?, totalWithdrawn=totalWithdrawn-? WHERE id=?',
      [Number(wd.amount), Number(wd.net), wd.userId]);
    run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
      [uid(), wd.userId, `❌ Withdrawal rejected. KES ${Number(wd.amount).toFixed(2)} refunded. Reason: ${reason}`, 'error', nowISO()]);
    res.json({ success: true });
  });

  // Investments
  app.get('/api/admin/investments', authMiddleware, adminOnly, (req, res) => {
    res.json(all(`SELECT i.*, u.firstName||' '||u.lastName as userName
                  FROM investments i JOIN users u ON i.userId=u.id ORDER BY i.createdAt DESC`));
  });

  // Transactions
  app.get('/api/admin/transactions', authMiddleware, adminOnly, (req, res) => {
    res.json(all(`SELECT t.*, u.firstName||' '||u.lastName as userName
                  FROM transactions t JOIN users u ON t.userId=u.id ORDER BY t.createdAt DESC LIMIT 200`));
  });

  // Plans CRUD
  app.get('/api/admin/plans', authMiddleware, adminOnly, (req, res) => {
    res.json(all('SELECT * FROM plans ORDER BY minAmount ASC'));
  });

  app.post('/api/admin/plans', authMiddleware, adminOnly, (req, res) => {
    const { name, roi, period, minAmount, maxAmount, referralBonus, color, description, popular, active } = req.body;
    const id = uid();
    run(`INSERT INTO plans (id,name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular,active,createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, name, roi, period, minAmount, maxAmount, referralBonus||5, color||'#00e676', description||'', popular||0, active??1, nowISO()]);
    res.json({ id, success: true });
  });

  app.put('/api/admin/plans/:id', authMiddleware, adminOnly, (req, res) => {
    const { name, roi, period, minAmount, maxAmount, referralBonus, color, description, popular, active } = req.body;
    run(`UPDATE plans SET
         name=COALESCE(?,name), roi=COALESCE(?,roi), period=COALESCE(?,period),
         minAmount=COALESCE(?,minAmount), maxAmount=COALESCE(?,maxAmount),
         referralBonus=COALESCE(?,referralBonus), color=COALESCE(?,color),
         description=COALESCE(?,description), popular=COALESCE(?,popular), active=COALESCE(?,active)
         WHERE id=?`,
      [name||null, roi??null, period??null, minAmount??null, maxAmount??null,
       referralBonus??null, color||null, description||null, popular??null, active??null, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/plans/:id', authMiddleware, adminOnly, (req, res) => {
    run('DELETE FROM plans WHERE id=?', [req.params.id]);
    res.json({ success: true });
  });

  // Settings
  app.get('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
    const rows = all('SELECT key,value FROM settings');
    const out  = {};
    rows.forEach(r => { out[r.key] = r.value; });
    res.json(out);
  });

  app.put('/api/admin/settings', authMiddleware, adminOnly, (req, res) => {
    for (const [k,v] of Object.entries(req.body)) {
      if (v !== undefined && v !== null)
        run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [k, String(v)]);
    }
    res.json({ success: true });
  });

  // Broadcast
  app.post('/api/admin/broadcast', authMiddleware, adminOnly, (req, res) => {
    const { userId, message, type } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    if (userId) {
      run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
        [uid(), userId, message, type||'info', nowISO()]);
    } else {
      const members = all(`SELECT id FROM users WHERE role='user' AND status='active'`);
      for (const u of members) {
        run(`INSERT INTO notifications (id,userId,message,type,createdAt) VALUES (?,?,?,?,?)`,
          [uid(), u.id, message, type||'info', nowISO()]);
      }
    }
    res.json({ success: true });
  });

  // M-Pesa logs
  app.get('/api/admin/mpesa-logs', authMiddleware, adminOnly, (req, res) => {
    res.json(all('SELECT * FROM mpesa_logs ORDER BY processedAt DESC LIMIT 100'));
  });

  // B2C logs stub
  app.get('/api/admin/b2c-logs', authMiddleware, adminOnly, (req, res) => res.json([]));

  // ── SPA fallbacks ─────────────────────────────────
  app.get('/admin*',     (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
  app.get('/dashboard*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`✅ Pesa Grow running on port ${PORT}`);
    console.log(`   Till: ${MPESA.shortcode} | URL: ${BASE_URL}`);
  });
}

boot().catch(e => { console.error('Boot failed:', e); process.exit(1); });
