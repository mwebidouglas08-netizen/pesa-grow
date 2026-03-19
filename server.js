/**
 * ╔══════════════════════════════════════════════════════╗
 *       PESA GROW — PRODUCTION BACKEND
 *  Node.js + Express + SQLite + M-Pesa Daraja API
 * ╚══════════════════════════════════════════════════════╝
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const axios      = require('axios');
const Database   = require('better-sqlite3');
const rateLimit  = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──────────────────────────────────────────
app.set('trust proxy', 1);
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true });
app.use('/api/', limiter);

// ── DATABASE ────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || './pesagrow.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    firstName   TEXT NOT NULL,
    lastName    TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    phone       TEXT,
    password    TEXT NOT NULL,
    role        TEXT DEFAULT 'user',
    status      TEXT DEFAULT 'active',
    balance     REAL DEFAULT 0,
    totalInvested  REAL DEFAULT 0,
    totalProfits   REAL DEFAULT 0,
    totalWithdrawn REAL DEFAULT 0,
    refCode     TEXT UNIQUE,
    referredBy  TEXT,
    kycStatus   TEXT DEFAULT 'none',
    createdAt   TEXT NOT NULL,
    lastLogin   TEXT
  );

  CREATE TABLE IF NOT EXISTS plans (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    roi           REAL NOT NULL,
    period        INTEGER NOT NULL,
    minAmount     REAL NOT NULL,
    maxAmount     REAL NOT NULL,
    referralBonus REAL DEFAULT 5,
    color         TEXT DEFAULT '#10b981',
    description   TEXT,
    popular       INTEGER DEFAULT 0,
    active        INTEGER DEFAULT 1,
    createdAt     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS investments (
    id           TEXT PRIMARY KEY,
    userId       TEXT NOT NULL,
    planId       TEXT NOT NULL,
    planName     TEXT,
    amount       REAL NOT NULL,
    roi          REAL NOT NULL,
    period       INTEGER NOT NULL,
    earned       REAL DEFAULT 0,
    status       TEXT DEFAULT 'active',
    startDate    TEXT NOT NULL,
    endDate      TEXT NOT NULL,
    lastCredited TEXT
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id              TEXT PRIMARY KEY,
    userId          TEXT NOT NULL,
    amount          REAL NOT NULL,
    method          TEXT DEFAULT 'M-Pesa',
    status          TEXT DEFAULT 'pending',
    mpesaCheckoutId TEXT,
    mpesaReceiptNo  TEXT,
    mpesaPhone      TEXT,
    proofNote       TEXT,
    reviewedBy      TEXT,
    reviewedAt      TEXT,
    rejectionReason TEXT,
    createdAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id              TEXT PRIMARY KEY,
    userId          TEXT NOT NULL,
    amount          REAL NOT NULL,
    fee             REAL DEFAULT 0,
    net             REAL NOT NULL,
    method          TEXT NOT NULL,
    address         TEXT NOT NULL,
    status          TEXT DEFAULT 'pending',
    reviewedBy      TEXT,
    reviewedAt      TEXT,
    rejectionReason TEXT,
    createdAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id          TEXT PRIMARY KEY,
    userId      TEXT NOT NULL,
    type        TEXT NOT NULL,
    amount      REAL NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'completed',
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id          TEXT PRIMARY KEY,
    referrerId  TEXT NOT NULL,
    refereeId   TEXT NOT NULL,
    earnings    REAL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS mpesa_logs (
    id              TEXT PRIMARY KEY,
    checkoutId      TEXT,
    phone           TEXT,
    amount          REAL,
    resultCode      TEXT,
    resultDesc      TEXT,
    receiptNo       TEXT,
    rawCallback     TEXT,
    processedAt     TEXT
  );
`);

// ── SEED DATA ───────────────────────────────────────────
function seedDefaults() {
  const now = new Date().toISOString();

  const adminExists = db.prepare("SELECT id FROM users WHERE role='admin'").get();
  if (!adminExists) {
    db.prepare(`INSERT INTO users (id,firstName,lastName,email,phone,password,role,status,refCode,createdAt,lastLogin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      uuidv4(),'Admin','PesaGrow','admin@pesagrow.co.ke',
      process.env.ADMIN_PHONE||'0796820013',
      bcrypt.hashSync('Admin@2024',10),'admin','active','ADMIN00',now,now
    );
    console.log('✅ Admin seeded: admin@pesagrow.co.ke / Admin@2024');
  }

  const planCount = db.prepare('SELECT COUNT(*) as c FROM plans').get().c;
  if (!planCount) {
    const plans = [
      { name:'Starter',  roi:3,  period:7,  min:1000,   max:9999,   color:'#22d3ee', ref:5,  desc:'Perfect entry-level plan', pop:0 },
      { name:'Silver',   roi:5,  period:14, min:10000,  max:49999,  color:'#a3a3a3', ref:5,  desc:'Steady daily returns',      pop:0 },
      { name:'Gold',     roi:7,  period:21, min:50000,  max:199999, color:'#f59e0b', ref:7,  desc:'High-performance plan',     pop:1 },
      { name:'Platinum', roi:10, period:30, min:200000, max:9999999,color:'#8b5cf6', ref:10, desc:'Elite returns',             pop:0 },
    ];
    const ins = db.prepare(`INSERT INTO plans (id,name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular,active,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`);
    plans.forEach(p => ins.run(uuidv4(),p.name,p.roi,p.period,p.min,p.max,p.ref,p.color,p.desc,p.pop,now));
    console.log('✅ Default plans seeded');
  }

  const settingCount = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
  if (!settingCount) {
    const defs = {
  siteName: 'Pesa Grow',
  sitePhone: '0796820013',
  siteEmail: 'support@pesagrow.co.ke',
  currency: 'KES',
  minDeposit: 1000,
  minWithdraw: 500,
  withdrawFee: 2,
  referralRate: 5,
  welcomeBonus: 0,
  mpesaTill: process.env.MPESA_SHORTCODE||'174379',
  mpesaName: 'PESA GROW LTD',
  maintenanceMode: 'false',
  minHoldingDays: 3
};
    const ins = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
    Object.entries(defs).forEach(([k,v]) => ins.run(k, String(v)));
    console.log('✅ Default settings seeded');
  }
}
seedDefaults();

// ── HELPERS ─────────────────────────────────────────────
const now = () => new Date().toISOString();
const genRef = () => 'REF' + Math.random().toString(36).substring(2,7).toUpperCase();
const getSetting = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;

function addTx(userId, type, amount, description, status='completed') {
  db.prepare('INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), userId, type, amount, description, status, now());
}
function addNotif(userId, message, type='info') {
  db.prepare('INSERT INTO notifications (id,userId,message,type,read,createdAt) VALUES (?,?,?,?,0,?)')
    .run(uuidv4(), userId, message, type, now());
}

// ── AUTH MIDDLEWARE ──────────────────────────────────────
function authUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'pesagrow_secret'); next(); }
  catch { res.status(401).json({ error: 'Token invalid or expired' }); }
}
function authAdmin(req, res, next) {
  authUser(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

// ══════════════════════════════════════════════════════
//  M-PESA DARAJA API
// ══════════════════════════════════════════════════════

const MPESA_BASE = process.env.MPESA_ENV === 'live'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

async function getMpesaToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');
  const res = await axios.get(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  return res.data.access_token;
}

function getMpesaPassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
  const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
  return { password: Buffer.from(raw).toString('base64'), timestamp };
}

function sanitizePhone(phone) {
  phone = String(phone).replace(/\s+/g,'').replace(/[^0-9]/g,'');
  if (phone.startsWith('0'))  phone = '254' + phone.slice(1);
  if (phone.startsWith('+'))  phone = phone.slice(1);
  if (!phone.startsWith('254')) phone = '254' + phone;
  return phone;
}

async function initiateSTKPush({ phone, amount, accountRef, depositId }) {
  const token = await getMpesaToken();
  const { password, timestamp } = getMpesaPassword();
  const callbackUrl = `${process.env.BASE_URL}/api/mpesa/callback`;

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   process.env.MPESA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline',
    Amount:            Math.ceil(amount),
    PartyA:            sanitizePhone(phone),
    PartyB:            process.env.MPESA_SHORTCODE,
    PhoneNumber:       sanitizePhone(phone),
    CallBackURL:       callbackUrl,
    AccountReference:  accountRef || 'PesaGrow',
    TransactionDesc:   `Deposit #${depositId?.slice(-6)||'PG'}`,
  };

  const res = await axios.post(
    `${MPESA_BASE}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data;
}

// ══════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, email, phone, password, refCode } = req.body;
  if (!firstName||!lastName||!email||!password) return res.status(400).json({ error: 'Fill all required fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });

  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (exists) return res.status(400).json({ error: 'Email already registered' });

  const hashed  = bcrypt.hashSync(password, 10);
  const userId  = uuidv4();
  const welcome = parseFloat(getSetting('welcomeBonus')||0);

  db.prepare(`INSERT INTO users (id,firstName,lastName,email,phone,password,role,status,balance,refCode,createdAt,lastLogin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, firstName, lastName, email, phone||'', hashed, 'user', 'active', welcome, genRef(), now(), now());

  if (refCode) {
    const referrer = db.prepare('SELECT id FROM users WHERE refCode=?').get(refCode);
    if (referrer) {
      db.prepare('UPDATE users SET referredBy=? WHERE id=?').run(referrer.id, userId);
      db.prepare('INSERT INTO referrals (id,referrerId,refereeId,earnings,createdAt) VALUES (?,?,?,0,?)')
        .run(uuidv4(), referrer.id, userId, now());
    }
  }

  if (welcome > 0) addTx(userId, 'bonus', welcome, 'Welcome bonus', 'completed');

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  const token = jwt.sign({ id: userId, role: 'user' }, process.env.JWT_SECRET || 'pesagrow_secret', { expiresIn: '7d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: 'Account not found' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(400).json({ error: 'Incorrect password' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended. Contact support: 0796820013' });

  db.prepare('UPDATE users SET lastLogin=? WHERE id=?').run(now(), user.id);
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'pesagrow_secret', { expiresIn: '7d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authUser, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

// ══════════════════════════════════════════════════════
//  M-PESA ROUTES
// ══════════════════════════════════════════════════════

app.post('/api/mpesa/stk-push', authUser, async (req, res) => {
  const { amount, phone } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const minDep = parseFloat(getSetting('minDeposit')||1000);
  if (!amount || amount < minDep) return res.status(400).json({ error: `Minimum deposit is KES ${minDep}` });
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const depositId = uuidv4();
  const mpesaPhone = sanitizePhone(phone);

  db.prepare(`INSERT INTO deposits (id,userId,amount,method,status,mpesaPhone,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(depositId, user.id, amount, 'M-Pesa STK', 'pending', mpesaPhone, now());
  addTx(user.id, 'deposit', amount, `M-Pesa STK deposit #${depositId.slice(-6)}`, 'pending');

  try {
    const stkRes = await initiateSTKPush({ phone: mpesaPhone, amount, accountRef: 'PesaGrow', depositId });

    if (stkRes.ResponseCode === '0') {
      db.prepare('UPDATE deposits SET mpesaCheckoutId=? WHERE id=?').run(stkRes.CheckoutRequestID, depositId);
      addNotif(user.id, `M-Pesa prompt sent to ${phone}. Enter your PIN to complete.`, 'info');
      res.json({ success: true, depositId, checkoutRequestId: stkRes.CheckoutRequestID, message: stkRes.CustomerMessage || 'Check your phone and enter M-Pesa PIN' });
    } else {
      db.prepare('UPDATE deposits SET status=? WHERE id=?').run('failed', depositId);
      res.status(400).json({ error: 'STK Push failed. ' + (stkRes.errorMessage||'Try again.') });
    }
  } catch (err) {
    console.error('STK Push error:', err.response?.data || err.message);
    db.prepare('UPDATE deposits SET status=? WHERE id=?').run('failed', depositId);
    res.status(500).json({ error: 'M-Pesa service error. Try manual deposit instead.' });
  }
});

app.get('/api/mpesa/status/:checkoutId', authUser, (req, res) => {
  const dep = db.prepare('SELECT * FROM deposits WHERE mpesaCheckoutId=? AND userId=?')
    .get(req.params.checkoutId, req.user.id);
  if (!dep) return res.status(404).json({ error: 'Deposit not found' });
  res.json({ status: dep.status, receiptNo: dep.mpesaReceiptNo });
});

app.post('/api/mpesa/callback', (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  try {
    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) return;

    const checkoutId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;

    let receiptNo = null, amount = null, phone = null;
    if (resultCode === 0 && stkCallback.CallbackMetadata?.Item) {
      const items = stkCallback.CallbackMetadata.Item;
      const getItem = name => items.find(i=>i.Name===name)?.Value;
      receiptNo = getItem('MpesaReceiptNumber');
      amount    = getItem('Amount');
      phone     = getItem('PhoneNumber');
    }

    db.prepare(`INSERT INTO mpesa_logs (id,checkoutId,phone,amount,resultCode,resultDesc,receiptNo,rawCallback,processedAt) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), checkoutId, phone, amount, resultCode, resultDesc, receiptNo, JSON.stringify(req.body), now());

    const deposit = db.prepare('SELECT * FROM deposits WHERE mpesaCheckoutId=?').get(checkoutId);
    if (!deposit) return;

    if (resultCode === 0) {
      const creditAmount = amount || deposit.amount;
      db.prepare(`UPDATE deposits SET status='approved', mpesaReceiptNo=?, mpesaPhone=?, reviewedAt=? WHERE id=?`)
        .run(receiptNo, phone, now(), deposit.id);
      db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(creditAmount, deposit.userId);
      db.prepare(`UPDATE transactions SET status='completed', description=? WHERE userId=? AND type='deposit' AND status='pending'`)
        .run(`M-Pesa ${receiptNo}`, deposit.userId);
      addNotif(deposit.userId, `✅ KES ${(+creditAmount).toFixed(2)} credited via M-Pesa (${receiptNo})`, 'success');

      const user = db.prepare('SELECT * FROM users WHERE id=?').get(deposit.userId);
      if (user.referredBy) {
        const ref = db.prepare('SELECT * FROM referrals WHERE refereeId=?').get(deposit.userId);
        if (ref) {
          const rate = parseFloat(getSetting('referralRate')||5) / 100;
          const commission = creditAmount * rate;
          db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(commission, user.referredBy);
          db.prepare('UPDATE referrals SET earnings=earnings+? WHERE id=?').run(commission, ref.id);
          addTx(user.referredBy, 'referral', commission, `Referral from ${user.firstName}`, 'completed');
          addNotif(user.referredBy, `💰 Referral commission: KES ${commission.toFixed(2)}!`, 'success');
        }
      }
    } else {
      db.prepare(`UPDATE deposits SET status='failed', rejectionReason=?, reviewedAt=? WHERE id=?`)
        .run(resultDesc, now(), deposit.id);
      addNotif(deposit.userId, `❌ M-Pesa failed: ${resultDesc}. Contact 0796820013.`, 'error');
    }
  } catch (err) {
    console.error('Callback error:', err.message);
  }
});

// ══════════════════════════════════════════════════════
//  USER ROUTES
// ══════════════════════════════════════════════════════

app.get('/api/user/dashboard', authUser, (req, res) => {
  const u      = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const invs   = db.prepare('SELECT * FROM investments WHERE userId=? ORDER BY startDate DESC').all(req.user.id);
  const txs    = db.prepare('SELECT * FROM transactions WHERE userId=? ORDER BY createdAt DESC LIMIT 20').all(req.user.id);
  const deps   = db.prepare('SELECT * FROM deposits WHERE userId=? ORDER BY createdAt DESC LIMIT 10').all(req.user.id);
  const wds    = db.prepare('SELECT * FROM withdrawals WHERE userId=? ORDER BY createdAt DESC LIMIT 10').all(req.user.id);
  const refs   = db.prepare('SELECT * FROM referrals WHERE referrerId=?').all(req.user.id);
  const notifs = db.prepare('SELECT * FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 20').all(req.user.id);
  const { password: _, ...safe } = u;
  res.json({ user: safe, investments: invs, transactions: txs, deposits: deps, withdrawals: wds, referrals: refs, notifications: notifs });
});

app.post('/api/user/invest', authUser, (req, res) => {
  const { planId, amount } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(planId);
  if (!plan) return res.status(400).json({ error: 'Plan not available' });
  if (amount < plan.minAmount) return res.status(400).json({ error: `Minimum is KES ${plan.minAmount.toLocaleString()}` });
  if (amount > plan.maxAmount) return res.status(400).json({ error: `Maximum is KES ${plan.maxAmount.toLocaleString()}` });
  if (user.balance < amount)   return res.status(400).json({ error: 'Insufficient balance. Please deposit first.' });

  const invId   = uuidv4();
  const endDate = new Date(Date.now() + plan.period * 86400000).toISOString();

  db.prepare(`INSERT INTO investments (id,userId,planId,planName,amount,roi,period,earned,status,startDate,endDate,lastCredited) VALUES (?,?,?,?,?,?,?,0,'active',?,?,?)`)
    .run(invId, user.id, plan.id, plan.name, amount, plan.roi, plan.period, now(), endDate, now());
  db.prepare('UPDATE users SET balance=balance-?, totalInvested=totalInvested+? WHERE id=?').run(amount, amount, user.id);
  addTx(user.id, 'investment', amount, `${plan.name} Plan`, 'completed');
  addNotif(user.id, `🚀 ${plan.name} plan activated! Earning ${plan.roi}% daily for ${plan.period} days.`, 'success');
  res.json({ success: true, investmentId: invId });
});

app.post('/api/user/withdraw', authUser, (req, res) => {
  const { amount, method, address } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const minWd   = parseFloat(getSetting('minWithdraw')||500);
  const feeRate = parseFloat(getSetting('withdrawFee')||2) / 100;
  // Minimum holding period check
  const holdDays = parseFloat(getSetting('minHoldingDays')||0);
  if (holdDays > 0) {
    const firstDep = db.prepare(
      "SELECT createdAt FROM deposits WHERE userId=? AND status='approved' ORDER BY createdAt ASC LIMIT 1"
    ).get(user.id);
    if (!firstDep) return res.status(400).json({ error: 'You must make a deposit before withdrawing.' });
    const daysSinceDeposit = (Date.now() - new Date(firstDep.createdAt).getTime()) / 86400000;
    if (daysSinceDeposit < holdDays) {
      const daysLeft = Math.ceil(holdDays - daysSinceDeposit);
      return res.status(400).json({ error: `Withdrawals unlock in ${daysLeft} day(s). Minimum holding period is ${holdDays} days.` });
    }
  }
  if (amount < minWd) return res.status(400).json({ error: `Minimum withdrawal is KES ${minWd}` });
  if (!address)       return res.status(400).json({ error: 'Provide M-Pesa number or account' });
  if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  const fee = amount * feeRate;
  const net = amount - fee;
  db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(amount, user.id);
  const wdId = uuidv4();
  db.prepare(`INSERT INTO withdrawals (id,userId,amount,fee,net,method,address,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(wdId, user.id, amount, fee, net, method||'M-Pesa', address, 'pending', now());
  addTx(user.id, 'withdrawal', amount, `${method||'M-Pesa'} withdrawal — pending`, 'pending');
  addNotif(user.id, `⏳ Withdrawal of KES ${amount.toFixed(2)} submitted. Processing within 2 hours.`, 'info');
  res.json({ success: true, withdrawalId: wdId, net, fee });
});

app.post('/api/user/deposit/manual', authUser, (req, res) => {
  const { amount, method, proofNote } = req.body;
  const minDep = parseFloat(getSetting('minDeposit')||1000);
  if (amount < minDep) return res.status(400).json({ error: `Minimum deposit is KES ${minDep}` });
  if (!proofNote) return res.status(400).json({ error: 'Provide your M-Pesa reference code' });

  const depId = uuidv4();
  db.prepare(`INSERT INTO deposits (id,userId,amount,method,status,proofNote,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(depId, req.user.id, amount, method||'M-Pesa', 'pending', proofNote, now());
  addTx(req.user.id, 'deposit', amount, `Manual deposit — pending`, 'pending');
  addNotif(req.user.id, `⏳ Deposit of KES ${amount.toFixed(2)} submitted. Admin confirms within 30 mins.`, 'info');
  res.json({ success: true, depositId: depId });
});

app.get('/api/user/notifications', authUser, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 30').all(req.user.id));
});
app.put('/api/user/notifications/read', authUser, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE userId=?').run(req.user.id);
  res.json({ success: true });
});
app.put('/api/user/profile', authUser, (req, res) => {
  const { firstName, lastName, phone } = req.body;
  db.prepare('UPDATE users SET firstName=COALESCE(?,firstName),lastName=COALESCE(?,lastName),phone=COALESCE(?,phone) WHERE id=?')
    .run(firstName||null, lastName||null, phone||null, req.user.id);
  res.json({ success: true });
});
app.put('/api/user/password', authUser, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(400).json({ error: 'Current password incorrect' });
  if ((newPassword||'').length < 8) return res.status(400).json({ error: 'New password must be 8+ characters' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ success: true });
});

app.get('/api/plans', (req, res) => {
  res.json(db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY minAmount ASC').all());
});
app.get('/api/settings/public', (req, res) => {
  const keys = ['siteName','sitePhone','siteEmail','currency','minDeposit','minWithdraw','withdrawFee','referralRate','mpesaTill','mpesaName','maintenanceMode'];
  const rows = db.prepare(`SELECT key,value FROM settings WHERE key IN (${keys.map(()=>'?').join(',')})`).all(...keys);
  res.json(Object.fromEntries(rows.map(r=>[r.key,r.value])));
});

// ══════════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════════

app.get('/api/admin/stats', authAdmin, (req, res) => {
  res.json({
    totalMembers:    db.prepare("SELECT COUNT(*) as c FROM users WHERE role!='admin'").get().c,
    activeInvestors: db.prepare("SELECT COUNT(DISTINCT userId) as c FROM investments WHERE status='active'").get().c,
    pendingDeps:     db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status='pending'").get().c,
    pendingWds:      db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'").get().c,
    totalDeposited:  db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE status='approved'").get().s,
    totalWithdrawn:  db.prepare("SELECT COALESCE(SUM(net),0) as s FROM withdrawals WHERE status='approved'").get().s,
    totalInvested:   db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM investments").get().s,
    totalProfitPaid: db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='profit'").get().s,
    recentUsers:     db.prepare("SELECT id,firstName,lastName,email,phone,balance,status,createdAt FROM users WHERE role!='admin' ORDER BY createdAt DESC LIMIT 5").all(),
    recentTx:        db.prepare("SELECT * FROM transactions ORDER BY createdAt DESC LIMIT 10").all(),
  });
});

app.get('/api/admin/members', authAdmin, (req, res) => {
  res.json(db.prepare("SELECT id,firstName,lastName,email,phone,balance,totalInvested,totalProfits,totalWithdrawn,status,refCode,kycStatus,createdAt,lastLogin FROM users WHERE role!='admin' ORDER BY createdAt DESC").all());
});
app.put('/api/admin/members/:id', authAdmin, (req, res) => {
  const { firstName, lastName, email, phone, balance, status } = req.body;
  db.prepare(`UPDATE users SET firstName=COALESCE(?,firstName),lastName=COALESCE(?,lastName),email=COALESCE(?,email),phone=COALESCE(?,phone),balance=COALESCE(?,balance),status=COALESCE(?,status) WHERE id=?`)
    .run(firstName||null,lastName||null,email||null,phone||null,balance!=null?balance:null,status||null,req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/deposits', authAdmin, (req, res) => {
  res.json(db.prepare(`SELECT d.*, u.firstName||' '||u.lastName as userName, u.phone as userPhone FROM deposits d LEFT JOIN users u ON d.userId=u.id ORDER BY d.createdAt DESC`).all());
});
app.put('/api/admin/deposits/:id/approve', authAdmin, (req, res) => {
  const dep = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Not found' });
  if (dep.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  db.prepare(`UPDATE deposits SET status='approved', reviewedBy=?, reviewedAt=? WHERE id=?`).run(req.user.id, now(), dep.id);
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(dep.amount, dep.userId);
  db.prepare(`UPDATE transactions SET status='completed' WHERE userId=? AND type='deposit' AND status='pending'`).run(dep.userId);
  addNotif(dep.userId, `✅ Deposit of KES ${(+dep.amount).toFixed(2)} approved!`, 'success');
  res.json({ success: true });
});
app.put('/api/admin/deposits/:id/reject', authAdmin, (req, res) => {
  const { reason } = req.body;
  const dep = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE deposits SET status='rejected', rejectionReason=?, reviewedBy=?, reviewedAt=? WHERE id=?`).run(reason||'Rejected', req.user.id, now(), dep.id);
  addNotif(dep.userId, `❌ Deposit rejected. Contact 0796820013`, 'error');
  res.json({ success: true });
});

app.get('/api/admin/withdrawals', authAdmin, (req, res) => {
  res.json(db.prepare(`SELECT w.*, u.firstName||' '||u.lastName as userName, u.phone as userPhone FROM withdrawals w LEFT JOIN users u ON w.userId=u.id ORDER BY w.createdAt DESC`).all());
});
app.put('/api/admin/withdrawals/:id/approve', authAdmin, (req, res) => {
  const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
  if (!wd) return res.status(404).json({ error: 'Not found' });
  if (wd.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  db.prepare(`UPDATE withdrawals SET status='approved', reviewedBy=?, reviewedAt=? WHERE id=?`).run(req.user.id, now(), wd.id);
  db.prepare('UPDATE users SET totalWithdrawn=totalWithdrawn+? WHERE id=?').run(wd.net, wd.userId);
  db.prepare(`UPDATE transactions SET status='completed' WHERE userId=? AND type='withdrawal' AND status='pending'`).run(wd.userId);
  addNotif(wd.userId, `✅ Withdrawal of KES ${(+wd.net).toFixed(2)} sent to ${wd.address}!`, 'success');
  res.json({ success: true });
});
app.put('/api/admin/withdrawals/:id/reject', authAdmin, (req, res) => {
  const { reason } = req.body;
  const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
  if (!wd) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE withdrawals SET status='rejected', rejectionReason=?, reviewedBy=?, reviewedAt=? WHERE id=?`).run(reason||'Rejected', req.user.id, now(), wd.id);
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(wd.amount, wd.userId);
  addNotif(wd.userId, `❌ Withdrawal rejected. KES ${(+wd.amount).toFixed(2)} refunded.`, 'error');
  res.json({ success: true });
});

app.get('/api/admin/investments', authAdmin, (req, res) => {
  res.json(db.prepare(`SELECT i.*, u.firstName||' '||u.lastName as userName FROM investments i LEFT JOIN users u ON i.userId=u.id ORDER BY i.startDate DESC`).all());
});
app.get('/api/admin/transactions', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM transactions ORDER BY createdAt DESC LIMIT 500').all());
});

app.get('/api/admin/plans', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM plans ORDER BY minAmount ASC').all());
});
app.post('/api/admin/plans', authAdmin, (req, res) => {
  const { name, roi, period, minAmount, maxAmount, referralBonus, color, description, popular } = req.body;
  if (!name||!roi||!period||!minAmount||!maxAmount) return res.status(400).json({ error: 'Fill all required fields' });
  const id = uuidv4();
  db.prepare(`INSERT INTO plans (id,name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular,active,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`)
    .run(id,name,roi,period,minAmount,maxAmount,referralBonus||5,color||'#10b981',description||'',popular?1:0,now());
  res.json({ success:true, id });
});
app.put('/api/admin/plans/:id', authAdmin, (req, res) => {
  const p = req.body;
  db.prepare(`UPDATE plans SET name=COALESCE(?,name),roi=COALESCE(?,roi),period=COALESCE(?,period),minAmount=COALESCE(?,minAmount),maxAmount=COALESCE(?,maxAmount),color=COALESCE(?,color),active=COALESCE(?,active) WHERE id=?`)
    .run(p.name||null,p.roi||null,p.period||null,p.minAmount||null,p.maxAmount||null,p.color||null,p.active!=null?p.active:null,req.params.id);
  res.json({ success:true });
});
app.delete('/api/admin/plans/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM plans WHERE id=?').run(req.params.id);
  res.json({ success:true });
});

app.get('/api/admin/settings', authAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map(r=>[r.key,r.value])));
});
app.put('/api/admin/settings', authAdmin, (req, res) => {
  const ins = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  Object.entries(req.body).forEach(([k,v]) => ins.run(k, String(v)));
  res.json({ success: true });
});

app.post('/api/admin/broadcast', authAdmin, (req, res) => {
  const { userId, message, type } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  if (userId) {
    addNotif(userId, message, type||'info');
  } else {
    db.prepare("SELECT id FROM users WHERE role!='admin'").all().forEach(m => addNotif(m.id, message, type||'info'));
  }
  res.json({ success: true });
});

app.post('/api/admin/adjust-balance', authAdmin, (req, res) => {
  const { userId, amount, type, reason } = req.body;
  if (!userId||!amount||!type||!reason) return res.status(400).json({ error: 'Fill all fields' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const delta = type==='credit' ? amount : -amount;
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(delta, userId);
  addTx(userId, 'bonus', Math.abs(amount), `Admin ${type}: ${reason}`, 'completed');
  addNotif(userId, `Admin ${type} of KES ${(+amount).toFixed(2)}: ${reason}`, 'info');
  res.json({ success: true });
});

app.get('/api/admin/mpesa-logs', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM mpesa_logs ORDER BY processedAt DESC LIMIT 100').all());
});

// ══════════════════════════════════════════════════════
//  PROFIT AUTO-CREDITING
// ══════════════════════════════════════════════════════
function creditProfits() {
  const active = db.prepare("SELECT * FROM investments WHERE status='active'").all();
  let credited = 0;
  for (const inv of active) {
    const nowTs   = Date.now();
    const endTs   = new Date(inv.endDate).getTime();
    const lastTs  = new Date(inv.lastCredited).getTime();
    const elapsed = (nowTs - lastTs) / 1000;
    const credit  = (inv.amount * (inv.roi / 100) / 86400) * elapsed;

    if (nowTs >= endTs) {
      const totalEarned = inv.earned + credit;
      db.prepare("UPDATE investments SET status='completed', earned=?, lastCredited=? WHERE id=?").run(totalEarned, now(), inv.id);
      db.prepare('UPDATE users SET balance=balance+?, totalProfits=totalProfits+? WHERE id=?').run(inv.amount + totalEarned, totalEarned, inv.userId);
      addTx(inv.userId, 'profit', totalEarned, `${inv.planName} matured — profit + principal credited`, 'completed');
      addNotif(inv.userId, `🎉 ${inv.planName} matured! KES ${totalEarned.toFixed(2)} profit + principal credited!`, 'success');
      credited++;
    } else {
      db.prepare("UPDATE investments SET earned=earned+?, lastCredited=? WHERE id=?").run(credit, now(), inv.id);
    }
  }
  if (credited > 0) console.log(`💰 Credited ${credited} matured investment(s)`);
}

creditProfits();
setInterval(creditProfits, 10 * 60 * 1000);

// ══════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║       PESA GROW BACKEND RUNNING         ║
╠══════════════════════════════════════════╣
║  PORT:  ${String(PORT).padEnd(33)}║
║  Admin: admin@pesagrow.co.ke            ║
║  Pass:  Admin@2024                      ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
