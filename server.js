require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const axios     = require('axios');
const Database  = require('better-sqlite3');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──────────────────────────────────────
app.set('trust proxy', 1);
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// ── PWA FILES — must come BEFORE express.static ──────
// Service worker needs Service-Worker-Allowed header
// Manifest needs correct Content-Type
// Both need no-cache so browser always gets latest version
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

// Static files (index.html, dashboard.html, icons, etc.)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: function(res, filePath) {
    // PNG icons — allow caching
    if (filePath.endsWith('.png')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true });
app.use('/api/', limiter);

// ── DATABASE ────────────────────────────────────────
const db = new Database(process.env.DB_PATH || './pesagrow.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// ── SCHEMA ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    firstName      TEXT NOT NULL,
    lastName       TEXT NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    phone          TEXT,
    password       TEXT NOT NULL,
    role           TEXT DEFAULT 'user',
    status         TEXT DEFAULT 'active',
    balance        REAL DEFAULT 0,
    totalInvested  REAL DEFAULT 0,
    totalProfits   REAL DEFAULT 0,
    totalWithdrawn REAL DEFAULT 0,
    refCode        TEXT UNIQUE,
    referredBy     TEXT,
    kycStatus      TEXT DEFAULT 'none',
    createdAt      TEXT NOT NULL,
    lastLogin      TEXT
  );

  CREATE TABLE IF NOT EXISTS plans (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    roi           REAL NOT NULL,
    period        INTEGER NOT NULL,
    minAmount     REAL NOT NULL,
    maxAmount     REAL NOT NULL,
    referralBonus REAL DEFAULT 5,
    color         TEXT DEFAULT '#00e676',
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
    id         TEXT PRIMARY KEY,
    referrerId TEXT NOT NULL,
    refereeId  TEXT NOT NULL,
    earnings   REAL DEFAULT 0,
    createdAt  TEXT NOT NULL
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
    id          TEXT PRIMARY KEY,
    checkoutId  TEXT,
    phone       TEXT,
    amount      REAL,
    resultCode  TEXT,
    resultDesc  TEXT,
    receiptNo   TEXT,
    rawCallback TEXT,
    processedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS b2c_logs (
    id                     TEXT PRIMARY KEY,
    withdrawalId           TEXT,
    conversationId         TEXT,
    originatorConvId       TEXT,
    phone                  TEXT,
    amount                 REAL,
    status                 TEXT DEFAULT 'pending',
    resultCode             TEXT,
    resultDesc             TEXT,
    transactionId          TEXT,
    transactionAmount      REAL,
    b2cRecipientIsRegCust  TEXT,
    b2cChargesPaidAcct     TEXT,
    rawResult              TEXT,
    createdAt              TEXT,
    completedAt            TEXT
  );
`);

// ── PATCH MISSING COLUMNS (safe for existing DBs) ──
const addCol = (table, col, type) => {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run(); } catch {}
};
addCol('users', 'totalInvested',  'REAL DEFAULT 0');
addCol('users', 'totalProfits',   'REAL DEFAULT 0');
addCol('users', 'totalWithdrawn', 'REAL DEFAULT 0');
addCol('users', 'kycStatus',      "TEXT DEFAULT 'none'");
addCol('users', 'referredBy',     'TEXT');
addCol('users', 'role',           "TEXT DEFAULT 'user'");
addCol('users', 'status',         "TEXT DEFAULT 'active'");
addCol('deposits', 'mpesaCheckoutId', 'TEXT');
addCol('deposits', 'mpesaReceiptNo',  'TEXT');
addCol('deposits', 'mpesaPhone',      'TEXT');
addCol('deposits', 'rejectionReason', 'TEXT');
addCol('deposits', 'reviewedBy',      'TEXT');
addCol('deposits', 'reviewedAt',      'TEXT');
addCol('deposits', 'proofNote',       'TEXT');
addCol('withdrawals', 'rejectionReason',    'TEXT');
addCol('withdrawals', 'reviewedBy',         'TEXT');
addCol('withdrawals', 'reviewedAt',         'TEXT');
addCol('withdrawals', 'mpesaConversationId','TEXT');
addCol('withdrawals', 'b2cTransactionId',   'TEXT');
addCol('withdrawals', 'b2cError',           'TEXT');
addCol('investments', 'planName',     'TEXT');
addCol('investments', 'lastCredited', 'TEXT');
addCol('investments', 'earned',       'REAL DEFAULT 0');

// ── SEED DEFAULTS ───────────────────────────────────
function seedDefaults() {
  const n = new Date().toISOString();

  const adminExists = db.prepare("SELECT id FROM users WHERE role='admin'").get();
  if (!adminExists) {
    db.prepare(`INSERT INTO users (id,firstName,lastName,email,phone,password,role,status,balance,totalInvested,totalProfits,totalWithdrawn,refCode,createdAt,lastLogin) VALUES (?,?,?,?,?,?,?,?,0,0,0,0,?,?,?)`)
      .run(uuidv4(),'Admin','PesaGrow','admin@pesagrow.co.ke',
        process.env.ADMIN_PHONE||'0796820013',
        bcrypt.hashSync('Admin@2024',10),'admin','active','ADMIN00',n,n);
    console.log('✅ Admin seeded: admin@pesagrow.co.ke / Admin@2024');
  }

  const planCount = db.prepare('SELECT COUNT(*) as c FROM plans').get().c;
  if (!planCount) {
    const plans = [
      {name:'Starter', roi:3,  period:7,  min:1000,   max:9999,   color:'#22d3ee', ref:5,  desc:'Perfect entry-level plan', pop:0},
      {name:'Silver',  roi:5,  period:14, min:10000,  max:49999,  color:'#a3a3a3', ref:5,  desc:'Steady daily returns',     pop:0},
      {name:'Gold',    roi:7,  period:21, min:50000,  max:199999, color:'#ffc107', ref:7,  desc:'High-performance plan',   pop:1},
      {name:'Platinum',roi:10, period:30, min:200000, max:9999999,color:'#b388ff', ref:10, desc:'Elite returns',           pop:0},
    ];
    const ins = db.prepare(`INSERT INTO plans (id,name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular,active,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`);
    plans.forEach(p => ins.run(uuidv4(),p.name,p.roi,p.period,p.min,p.max,p.ref,p.color,p.desc,p.pop,n));
    console.log('✅ Default plans seeded');
  }

  const settingCount = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
  if (!settingCount) {
    const defs = {
      siteName:'Pesa Grow', sitePhone:'0796820013', siteEmail:'support@pesagrow.co.ke',
      currency:'KES', minDeposit:1000, minWithdraw:500, withdrawFee:2,
      referralRate:5, welcomeBonus:0, minHoldingDays:3,
      principalLockDays:90,
      maxDailyWithdrawals:3,
      mpesaTill: process.env.MPESA_SHORTCODE||'174379',
      mpesaName:'PESA GROW LTD',
      maintenanceMode:'false'
    };
    const ins = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
    Object.entries(defs).forEach(([k,v]) => ins.run(k, String(v)));
    console.log('✅ Default settings seeded');
  }
}
seedDefaults();

// ── HELPERS ─────────────────────────────────────────
function validateAmount(amount, min = 1, max = 10000000) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    throw new Error('Amount must be a number');
  }
  if (amount < min) {
    throw new Error(`Amount must be at least ${min}`);
  }
  if (amount > max) {
    throw new Error(`Amount too large`);
  }
}
const now = () => new Date().toISOString();
const genRef = () => 'REF' + Math.random().toString(36).substring(2,7).toUpperCase();
const getSetting = key => { try { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value; } catch { return null; } };

function addTx(userId, type, amount, description, status='completed') {
  try { db.prepare('INSERT INTO transactions (id,userId,type,amount,description,status,createdAt) VALUES (?,?,?,?,?,?,?)').run(uuidv4(),userId,type,amount,description,status,now()); } catch {}
}
function addNotif(userId, message, type='info') {
  try { db.prepare('INSERT INTO notifications (id,userId,message,type,read,createdAt) VALUES (?,?,?,?,0,?)').run(uuidv4(),userId,message,type,now()); } catch {}
}

// ── AUTH MIDDLEWARE ──────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set in environment variables');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

function authUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalid or expired — please login again' }); }
}
function authAdmin(req, res, next) {
  authUser(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

// ══════════════════════════════════════════════════
//  M-PESA DARAJA
// ══════════════════════════════════════════════════
const MPESA_BASE = process.env.MPESA_ENV === 'live'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

async function getMpesaToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const r = await axios.get(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
  return r.data.access_token;
}

function getMpesaPassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
  const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
  return { password: Buffer.from(raw).toString('base64'), timestamp };
}

function sanitizePhone(phone) {
  phone = String(phone).replace(/\s+/g,'').replace(/[^0-9]/g,'');
  if (phone.startsWith('0'))    phone = '254' + phone.slice(1);
  if (phone.startsWith('+'))    phone = phone.slice(1);
  if (!phone.startsWith('254')) phone = '254' + phone;
  return phone;
}

// ══════════════════════════════════════════════════
//  M-PESA B2C — Send money to user's phone
//  Used when admin approves a withdrawal
// ══════════════════════════════════════════════════
async function sendB2CPayment({ phone, amount, withdrawalId, remarks }) {
  const token = await getMpesaToken();

  // B2C security credential — base64 encoded with Safaricom public cert
  // Set MPESA_B2C_SECURITY_CREDENTIAL in Railway env vars
  const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
  if (!securityCredential) throw new Error('B2C not configured. Set MPESA_B2C_SECURITY_CREDENTIAL in Railway env vars.');

  const payload = {
    InitiatorName:          process.env.MPESA_B2C_INITIATOR_NAME || 'testapi',
    SecurityCredential:     securityCredential,
    CommandID:              'BusinessPayment',   // Direct payment to customer
    Amount:                 Math.floor(amount),  // Whole numbers only
    PartyA:                 process.env.MPESA_SHORTCODE,
    PartyB:                 sanitizePhone(phone),
    Remarks:                remarks || `Withdrawal #${(withdrawalId||'').slice(-6)}`,
    QueueTimeOutURL:        `${process.env.BASE_URL}/api/mpesa/b2c/timeout`,
    ResultURL:              `${process.env.BASE_URL}/api/mpesa/b2c/result`,
    Occasion:               'Withdrawal',
  };

  const r = await axios.post(
    `${MPESA_BASE}/mpesa/b2c/v3/paymentrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return r.data;
  // Returns { ConversationID, OriginatorConversationID, ResponseCode, ResponseDescription }
}

async function initiateSTKPush({ phone, amount, depositId }) {
  const token = await getMpesaToken();
  const { password, timestamp } = getMpesaPassword();
  const r = await axios.post(`${MPESA_BASE}/mpesa/stkpush/v1/processrequest`, {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline',
    Amount: Math.ceil(amount),
    PartyA: sanitizePhone(phone),
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: sanitizePhone(phone),
    CallBackURL: `${process.env.BASE_URL}/api/mpesa/callback`,
    AccountReference: 'PesaGrow',
    TransactionDesc: `Deposit #${(depositId||'').slice(-6)||'PG'}`,
  }, { headers: { Authorization: `Bearer ${token}` } });
  return r.data;
}

// ══════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, refCode } = req.body;
    if (!firstName||!lastName||!email||!password) return res.status(400).json({ error: 'Fill all required fields' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(400).json({ error: 'Email already registered' });

    const userId  = uuidv4();
    const welcome = parseFloat(getSetting('welcomeBonus')||0);

    db.prepare(`INSERT INTO users (id,firstName,lastName,email,phone,password,role,status,balance,totalInvested,totalProfits,totalWithdrawn,refCode,createdAt,lastLogin) VALUES (?,?,?,?,?,?,?,?,?,0,0,0,?,?,?)`)
      .run(userId,firstName,lastName,email,phone||'',bcrypt.hashSync(password,10),'user','active',welcome,genRef(),now(),now());

    if (refCode) {
      const referrer = db.prepare('SELECT id FROM users WHERE refCode=?').get(refCode);
      if (referrer) {
        try { db.prepare('UPDATE users SET referredBy=? WHERE id=?').run(referrer.id,userId); } catch {}
        try { db.prepare('INSERT INTO referrals (id,referrerId,refereeId,earnings,createdAt) VALUES (?,?,?,0,?)').run(uuidv4(),referrer.id,userId,now()); } catch {}
      }
    }
    if (welcome > 0) addTx(userId,'bonus',welcome,'Welcome bonus','completed');

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    const token = jwt.sign({ id:userId, role:'user' }, JWT_SECRET, { expiresIn:'7d' });
    const { password:_, ...safe } = user;
    res.json({ token, user: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) return res.status(400).json({ error: 'Account not found' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(400).json({ error: 'Incorrect password' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended. Contact 0796820013' });
    db.prepare('UPDATE users SET lastLogin=? WHERE id=?').run(now(),user.id);
    const token = jwt.sign({ id:user.id, role:user.role }, JWT_SECRET, { expiresIn:'7d' });
    const { password:_, ...safe } = user;
    res.json({ token, user: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authUser, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const { password:_, ...safe } = user;
    res.json(safe);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════
//  M-PESA ROUTES
// ══════════════════════════════════════════════════

app.post('/api/mpesa/stk-push', authUser, async (req, res) => {
  try {
    const { amount, phone } = req.body;
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found — please login again' });

    const minDep = parseFloat(getSetting('minDeposit')||1000);
    if (!amount || amount < minDep) return res.status(400).json({ error: `Minimum deposit is KES ${minDep}` });
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const depositId  = uuidv4();
    const mpesaPhone = sanitizePhone(phone);
    db.prepare(`INSERT INTO deposits (id,userId,amount,method,status,mpesaPhone,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(depositId,user.id,amount,'M-Pesa STK','pending',mpesaPhone,now());
    addTx(user.id,'deposit',amount,`M-Pesa STK deposit #${depositId.slice(-6)}`,'pending');

    const stkRes = await initiateSTKPush({ phone:mpesaPhone, amount, depositId });
    if (stkRes.ResponseCode === '0') {
      db.prepare('UPDATE deposits SET mpesaCheckoutId=? WHERE id=?').run(stkRes.CheckoutRequestID,depositId);
      addNotif(user.id,`M-Pesa prompt sent to ${phone}. Enter your PIN.`,'info');
      res.json({ success:true, depositId, checkoutRequestId:stkRes.CheckoutRequestID, message:stkRes.CustomerMessage||'Check your phone' });
    } else {
      db.prepare("UPDATE deposits SET status='failed' WHERE id=?").run(depositId);
      res.status(400).json({ error:'STK Push failed: '+(stkRes.errorMessage||'Try again') });
    }
  } catch(e) {
    console.error('STK Push error:', e.response?.data || e.message);
    res.status(500).json({ error:'M-Pesa error: '+(e.response?.data?.errorMessage||e.message) });
  }
});

app.get('/api/mpesa/status/:checkoutId', authUser, (req, res) => {
  try {
    const dep = db.prepare('SELECT * FROM deposits WHERE mpesaCheckoutId=? AND userId=?').get(req.params.checkoutId,req.user.id);
    if (!dep) return res.status(404).json({ error: 'Deposit not found' });
    res.json({ status: dep.status, receiptNo: dep.mpesaReceiptNo });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mpesa/callback', (req, res) => {
  res.json({ ResultCode:0, ResultDesc:'Accepted' });
  try {
    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) return;
    const { CheckoutRequestID:checkoutId, ResultCode:resultCode, ResultDesc:resultDesc } = stkCallback;
    let receiptNo=null, amount=null, phone=null;
    if (resultCode===0 && stkCallback.CallbackMetadata?.Item) {
      const getItem = name => stkCallback.CallbackMetadata.Item.find(i=>i.Name===name)?.Value;
      receiptNo = getItem('MpesaReceiptNumber');
      amount    = getItem('Amount');
      phone     = getItem('PhoneNumber');
    }
    try { db.prepare(`INSERT INTO mpesa_logs (id,checkoutId,phone,amount,resultCode,resultDesc,receiptNo,rawCallback,processedAt) VALUES (?,?,?,?,?,?,?,?,?)`).run(uuidv4(),checkoutId,phone,amount,resultCode,resultDesc,receiptNo,JSON.stringify(req.body),now()); } catch {}

    const deposit = db.prepare('SELECT * FROM deposits WHERE mpesaCheckoutId=?').get(checkoutId);
    if (!deposit) return;
    if (deposit.status === 'approved') return; // prevent double credit

    if (resultCode === 0) {
      const credit = amount || deposit.amount;
      db.prepare("UPDATE deposits SET status='approved',mpesaReceiptNo=?,mpesaPhone=?,reviewedAt=? WHERE id=?").run(receiptNo,phone,now(),deposit.id);
     const trx = db.transaction(() => {
  db.prepare('UPDATE deposits SET status="approved",mpesaReceiptNo=?,mpesaPhone=?,reviewedAt=? WHERE id=?')
    .run(receiptNo, phone, now(), deposit.id);

  db.prepare('UPDATE users SET balance=balance+? WHERE id=?')
    .run(credit, deposit.userId);

  db.prepare("UPDATE transactions SET status='completed',description=? WHERE userId=? AND type='deposit' AND status='pending'")
    .run(`M-Pesa ${receiptNo}`, deposit.userId);
});

trx();
      db.prepare("UPDATE transactions SET status='completed',description=? WHERE userId=? AND type='deposit' AND status='pending'").run(`M-Pesa ${receiptNo}`,deposit.userId);
      addNotif(deposit.userId,`✅ KES ${(+credit).toFixed(2)} deposited via M-Pesa (${receiptNo})`,'success');
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(deposit.userId);
      if (user?.referredBy) {
        const ref = db.prepare('SELECT * FROM referrals WHERE refereeId=?').get(deposit.userId);
        if (ref) {
          const commission = credit * (parseFloat(getSetting('referralRate')||5)/100);
          db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(commission,user.referredBy);
          db.prepare('UPDATE referrals SET earnings=earnings+? WHERE id=?').run(commission,ref.id);
          addTx(user.referredBy,'referral',commission,`Referral from ${user.firstName}`,'completed');
          addNotif(user.referredBy,`💰 Referral commission KES ${commission.toFixed(2)} from ${user.firstName}!`,'success');
        }
      }
    } else {
      db.prepare("UPDATE deposits SET status='failed',rejectionReason=?,reviewedAt=? WHERE id=?").run(resultDesc,now(),deposit.id);
      addNotif(deposit.userId,`❌ M-Pesa failed: ${resultDesc}. Contact 0796820013.`,'error');
    }
  } catch(e) { console.error('Callback error:', e.message); }
});

// ══════════════════════════════════════════════════
//  USER ROUTES
// ══════════════════════════════════════════════════

app.get('/api/user/dashboard', authUser, (req, res) => {
  try {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const invs   = db.prepare('SELECT * FROM investments WHERE userId=? ORDER BY startDate DESC').all(req.user.id);
    const txs    = db.prepare('SELECT * FROM transactions WHERE userId=? ORDER BY createdAt DESC LIMIT 50').all(req.user.id);
    const deps   = db.prepare('SELECT * FROM deposits WHERE userId=? ORDER BY createdAt DESC LIMIT 20').all(req.user.id);
    const wds    = db.prepare('SELECT * FROM withdrawals WHERE userId=? ORDER BY createdAt DESC LIMIT 20').all(req.user.id);
    const refs   = db.prepare('SELECT * FROM referrals WHERE referrerId=?').all(req.user.id);
    const notifs = db.prepare('SELECT * FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 30').all(req.user.id);
    const { password:_, ...safe } = u;
    res.json({ user:safe, investments:invs, transactions:txs, deposits:deps, withdrawals:wds, referrals:refs, notifications:notifs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/invest', authUser, (req, res) => {
  try {
    const { planId, amount } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(planId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!plan) return res.status(400).json({ error: 'Plan not available' });
    if (amount < plan.minAmount) return res.status(400).json({ error: `Minimum is KES ${(+plan.minAmount).toLocaleString()}` });
    if (amount > plan.maxAmount) return res.status(400).json({ error: `Maximum is KES ${(+plan.maxAmount).toLocaleString()}` });
    if (user.balance < amount)   return res.status(400).json({ error: 'Insufficient balance. Please deposit first.' });
    const invId   = uuidv4();
    const endDate = new Date(Date.now() + plan.period * 86400000).toISOString();
    db.prepare(`INSERT INTO investments (id,userId,planId,planName,amount,roi,period,earned,status,startDate,endDate,lastCredited) VALUES (?,?,?,?,?,?,?,0,'active',?,?,?)`)
      .run(invId,user.id,plan.id,plan.name,amount,plan.roi,plan.period,now(),endDate,now());
    db.prepare('UPDATE users SET balance=balance-?,totalInvested=totalInvested+? WHERE id=?').run(amount,amount,user.id);
    addTx(user.id,'investment',amount,`${plan.name} Plan`,'completed');
    addNotif(user.id,`🚀 ${plan.name} plan activated! Earning ${plan.roi}% daily for ${plan.period} days.`,'success');
    res.json({ success:true, investmentId:invId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/withdraw', authUser, (req, res) => {
  try {
    const { amount, method, address } = req.body;
    const user    = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const minWd   = parseFloat(getSetting('minWithdraw')||500);
    const feeRate = parseFloat(getSetting('withdrawFee')||2) / 100;

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!amount || amount < minWd) return res.status(400).json({ error: `Minimum withdrawal is KES ${minWd.toLocaleString()}` });
    if (!address) return res.status(400).json({ error: 'Enter your M-Pesa number or account' });
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

    // ── RULE 1: Max 3 withdrawals per day ──────────────────
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayWds = db.prepare(`
      SELECT COUNT(*) as c FROM withdrawals
      WHERE userId=? AND status != 'rejected'
      AND createdAt >= ?
    `).get(user.id, todayStart.toISOString()).c;

    const maxDailyWds = parseInt(getSetting('maxDailyWithdrawals')||3);
    if (todayWds >= maxDailyWds) {
      return res.status(400).json({
        error: `Daily withdrawal limit reached. You can withdraw up to ${maxDailyWds} times per day. Resets at midnight.`
      });
    }

    // ── RULE 2: Only profits can be withdrawn ──────────────
    // Principal is locked for 90 days from first investment
    // Calculate withdrawable profit balance
    const LOCK_DAYS = parseInt(getSetting('principalLockDays')||90);

    // Total profits earned (from profit transactions)
    const totalProfitsEarned = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as s FROM transactions
      WHERE userId=? AND type='profit' AND status='completed'
    `).get(user.id).s;

    // Total referral bonuses earned
    const totalReferralEarned = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as s FROM transactions
      WHERE userId=? AND type IN ('referral','bonus') AND status='completed'
    `).get(user.id).s;

    // Total already withdrawn (approved withdrawals)
    const totalWithdrawnSoFar = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as s FROM withdrawals
      WHERE userId=? AND status='approved'
    `).get(user.id).s;

    // Withdrawable balance = profits + bonuses - already withdrawn
    const withdrawableBalance = Math.max(0,
      totalProfitsEarned + totalReferralEarned - totalWithdrawnSoFar
    );

    // Check if any principal is still locked (investment < 90 days old)
    const lockedInvestments = db.prepare(`
      SELECT COUNT(*) as c FROM investments
      WHERE userId=? AND status='active'
      AND (julianday('now') - julianday(startDate)) < ?
    `).get(user.id, LOCK_DAYS).c;

    const hasPrincipalLocked = lockedInvestments > 0;

    // If principal is locked, user can only withdraw up to withdrawable (profit) balance
    if (hasPrincipalLocked && amount > withdrawableBalance) {
      const daysInfo = db.prepare(`
        SELECT startDate,
               ? - (julianday('now') - julianday(startDate)) as daysLeft
        FROM investments
        WHERE userId=? AND status='active'
        ORDER BY startDate ASC LIMIT 1
      `).get(LOCK_DAYS, user.id);

      const daysLeft = daysInfo ? Math.ceil(daysInfo.daysLeft) : LOCK_DAYS;

      return res.status(400).json({
        error: `Your initial investment is locked for ${LOCK_DAYS} days. ` +
               `You can only withdraw profits. ` +
               `Available profit balance: KES ${withdrawableBalance.toFixed(2)}. ` +
               `Principal unlocks in ${daysLeft} day(s).`,
        withdrawableBalance,
        daysLeft,
        principalLocked: true
      });
    }

    // All checks passed — process withdrawal
    const fee = amount * feeRate;
    const net = amount - fee;
    const wdId = uuidv4();

const trx = db.transaction(() => {
  db.prepare('UPDATE users SET balance=balance-? WHERE id=?')
    .run(amount, user.id);

  db.prepare(`INSERT INTO withdrawals (id,userId,amount,fee,net,method,address,status,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(wdId, user.id, amount, fee, net, method||'M-Pesa', address, 'pending', now());

  addTx(user.id, 'withdrawal', amount, `${method||'M-Pesa'} withdrawal — pending`, 'pending');
});

trx();
    const remaining = maxDailyWds - todayWds - 1;
    addNotif(user.id,
      `⏳ Withdrawal of KES ${amount.toFixed(2)} submitted. ` +
      `You have ${remaining} withdrawal(s) remaining today.`,
      'info'
    );

    res.json({ success:true, withdrawalId:wdId, net, fee, withdrawalsRemainingToday: remaining });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/user/withdraw-info — returns withdrawal limits for the dashboard
app.get('/api/user/withdraw-info', authUser, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const LOCK_DAYS   = parseInt(getSetting('principalLockDays')||90);
    const maxDailyWds = parseInt(getSetting('maxDailyWithdrawals')||3);
    const feeRate     = parseFloat(getSetting('withdrawFee')||2);
    const minWd       = parseFloat(getSetting('minWithdraw')||500);

    // Today's withdrawal count
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayWds = db.prepare(`
      SELECT COUNT(*) as c FROM withdrawals
      WHERE userId=? AND status != 'rejected' AND createdAt >= ?
    `).get(user.id, todayStart.toISOString()).c;

    // Profit balance calculation
    const totalProfitsEarned  = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE userId=? AND type='profit' AND status='completed'`).get(user.id).s;
    const totalReferralEarned = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE userId=? AND type IN ('referral','bonus') AND status='completed'`).get(user.id).s;
    const totalWithdrawnSoFar = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE userId=? AND status='approved'`).get(user.id).s;
    const withdrawableBalance = Math.max(0, totalProfitsEarned + totalReferralEarned - totalWithdrawnSoFar);

    // Locked investments
    const lockedInvs = db.prepare(`
      SELECT id, amount, startDate,
             ? - (julianday('now') - julianday(startDate)) as daysLeft,
             julianday('now') - julianday(startDate) as daysIn
      FROM investments
      WHERE userId=? AND status='active'
      ORDER BY startDate ASC
    `).all(LOCK_DAYS, user.id);

    const totalLocked = lockedInvs.reduce((s,i)=>s+(+i.amount||0),0);
    const earliestUnlock = lockedInvs.length > 0 ? Math.ceil(lockedInvs[0].daysLeft) : 0;

    res.json({
      withdrawableBalance,
      totalBalance: user.balance,
      totalLocked,
      principalLocked: lockedInvs.length > 0,
      earliestUnlockDays: earliestUnlock,
      lockDays: LOCK_DAYS,
      todayWithdrawals: todayWds,
      maxDailyWithdrawals: maxDailyWds,
      withdrawalsRemaining: Math.max(0, maxDailyWds - todayWds),
      feeRate,
      minWithdraw: minWd,
      lockedInvestments: lockedInvs
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user/deposit/manual', authUser, (req, res) => {
  try {
    const { amount, method, proofNote } = req.body;
    const minDep = parseFloat(getSetting('minDeposit')||1000);
    if (amount < minDep) return res.status(400).json({ error: `Minimum deposit is KES ${minDep}` });
    if (!proofNote) return res.status(400).json({ error: 'Enter your M-Pesa transaction code' });
    const depId = uuidv4();
    db.prepare(`INSERT INTO deposits (id,userId,amount,method,status,proofNote,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(depId,req.user.id,amount,method||'M-Pesa','pending',proofNote,now());
    addTx(req.user.id,'deposit',amount,'Manual deposit — pending','pending');
    addNotif(req.user.id,`⏳ Deposit of KES ${amount.toFixed(2)} submitted. Admin confirms within 30 mins.`,'info');
    res.json({ success:true, depositId:depId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/notifications', authUser, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 30').all(req.user.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/user/notifications/read', authUser, (req, res) => {
  try { db.prepare('UPDATE notifications SET read=1 WHERE userId=?').run(req.user.id); res.json({ success:true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/user/profile', authUser, (req, res) => {
  try {
    const { firstName, lastName, phone } = req.body;
    db.prepare('UPDATE users SET firstName=COALESCE(?,firstName),lastName=COALESCE(?,lastName),phone=COALESCE(?,phone) WHERE id=?')
      .run(firstName||null,lastName||null,phone||null,req.user.id);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/user/password', authUser, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(400).json({ error: 'Current password incorrect' });
    if ((newPassword||'').length < 8) return res.status(400).json({ error: 'New password must be 8+ characters' });
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword,10),req.user.id);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/plans', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY minAmount ASC').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/settings/public', (req, res) => {
  try {
    const keys = ['siteName','sitePhone','siteEmail','currency','minDeposit','minWithdraw','withdrawFee','referralRate','mpesaTill','mpesaName','maintenanceMode'];
    const rows = db.prepare(`SELECT key,value FROM settings WHERE key IN (${keys.map(()=>'?').join(',')})`).all(...keys);
    res.json(Object.fromEntries(rows.map(r=>[r.key,r.value])));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════

app.get('/api/admin/stats', authAdmin, (req, res) => {
  try {
    res.json({
      totalMembers:    db.prepare("SELECT COUNT(*) as c FROM users WHERE role!='admin'").get().c,
      activeInvestors: db.prepare("SELECT COUNT(DISTINCT userId) as c FROM investments WHERE status='active'").get().c,
      pendingDeps:     db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status='pending'").get().c,
      pendingWds:      db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'").get().c,
      totalDeposited:  db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE status='approved'").get().s,
      totalWithdrawn:  db.prepare("SELECT COALESCE(SUM(net),0) as s FROM withdrawals WHERE status='approved'").get().s,
      totalInvested:   db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM investments").get().s,
      totalProfitPaid: db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='profit' AND status='completed'").get().s,
      recentUsers:     db.prepare("SELECT id,firstName,lastName,email,phone,balance,status,createdAt FROM users WHERE role!='admin' ORDER BY createdAt DESC LIMIT 5").all(),
      recentTx:        db.prepare("SELECT * FROM transactions ORDER BY createdAt DESC LIMIT 10").all(),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/members', authAdmin, (req, res) => {
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);
    const want = ['id','firstName','lastName','email','phone','balance','totalInvested','totalProfits','totalWithdrawn','status','refCode','kycStatus','createdAt','lastLogin','role'];
    const sel  = want.filter(c=>cols.includes(c)).join(',');
    res.json(db.prepare(`SELECT ${sel} FROM users WHERE role!='admin' ORDER BY createdAt DESC`).all());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/members/:id', authAdmin, (req, res) => {
  try {
    const { firstName, lastName, email, phone, balance, status } = req.body;
    db.prepare(`UPDATE users SET firstName=COALESCE(?,firstName),lastName=COALESCE(?,lastName),email=COALESCE(?,email),phone=COALESCE(?,phone),balance=COALESCE(?,balance),status=COALESCE(?,status) WHERE id=?`)
      .run(firstName||null,lastName||null,email||null,phone||null,balance!=null?balance:null,status||null,req.params.id);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/deposits', authAdmin, (req, res) => {
  try {
    res.json(db.prepare(`SELECT d.*,u.firstName||' '||u.lastName as userName,u.phone as userPhone FROM deposits d LEFT JOIN users u ON d.userId=u.id ORDER BY d.createdAt DESC`).all());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/deposits/:id/approve', authAdmin, (req, res) => {
  try {
    const dep = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Not found' });
    if (dep.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    db.prepare("UPDATE deposits SET status='approved',reviewedBy=?,reviewedAt=? WHERE id=?").run(req.user.id,now(),dep.id);
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(dep.amount,dep.userId);
    db.prepare("UPDATE transactions SET status='completed' WHERE userId=? AND type='deposit' AND status='pending'").run(dep.userId);
    addNotif(dep.userId,`✅ Deposit of KES ${(+dep.amount).toFixed(2)} approved!`,'success');
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/deposits/:id/reject', authAdmin, (req, res) => {
  try {
    const { reason } = req.body;
    const dep = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
    if (!dep) return res.status(404).json({ error: 'Not found' });
    db.prepare("UPDATE deposits SET status='rejected',rejectionReason=?,reviewedBy=?,reviewedAt=? WHERE id=?").run(reason||'Rejected',req.user.id,now(),dep.id);
    addNotif(dep.userId,`❌ Deposit rejected. Contact 0796820013`,'error');
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/withdrawals', authAdmin, (req, res) => {
  try {
    res.json(db.prepare(`SELECT w.*,u.firstName||' '||u.lastName as userName,u.phone as userPhone FROM withdrawals w LEFT JOIN users u ON w.userId=u.id ORDER BY w.createdAt DESC`).all());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WITHDRAWAL APPROVE WITH AUTO B2C PAYMENT ──────
app.put('/api/admin/withdrawals/:id/approve', authAdmin, async (req, res) => {
  try {
    const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
    if (!wd) return res.status(404).json({ error: 'Not found' });
    if (wd.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(wd.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check if B2C is configured
    const b2cConfigured = !!(
      process.env.MPESA_B2C_SECURITY_CREDENTIAL &&
      process.env.MPESA_B2C_INITIATOR_NAME &&
      process.env.MPESA_SHORTCODE
    );

    if (b2cConfigured && wd.method === 'M-Pesa') {
      // ── AUTO B2C PAYMENT ──────────────────────────
      try {
        const phone = wd.address || user.phone;
        const b2cRes = await sendB2CPayment({
          phone,
          amount: wd.net,
          withdrawalId: wd.id,
          remarks: `Pesa Grow withdrawal for ${user.firstName}`
        });

        if (b2cRes.ResponseCode === '0') {
          // Payment request sent — mark as processing
          // Will be fully confirmed when B2C result callback arrives
          const b2cId = uuidv4();
          db.prepare(`INSERT INTO b2c_logs
            (id,withdrawalId,conversationId,originatorConvId,phone,amount,status,createdAt)
            VALUES (?,?,?,?,?,?,?,?)`)
            .run(b2cId, wd.id, b2cRes.ConversationID, b2cRes.OriginatorConversationID,
                 phone, wd.net, 'pending', now());

          // Mark withdrawal as processing (not yet fully approved — wait for callback)
          db.prepare("UPDATE withdrawals SET status='processing',reviewedBy=?,reviewedAt=?,mpesaConversationId=? WHERE id=?")
            .run(req.user.id, now(), b2cRes.ConversationID, wd.id);

          addNotif(wd.userId,
            `⏳ Your withdrawal of KES ${(+wd.net).toFixed(2)} is being sent to ${phone} via M-Pesa...`,
            'info');

          return res.json({
            success: true,
            b2c: true,
            message: `M-Pesa B2C payment of KES ${wd.net} initiated to ${phone}. Awaiting confirmation.`,
            conversationId: b2cRes.ConversationID
          });

        } else {
          throw new Error(b2cRes.ResponseDescription || 'B2C request failed');
        }

      } catch(b2cErr) {
        console.error('B2C error:', b2cErr.response?.data || b2cErr.message);
        // B2C failed — fall through to manual approval
        // Admin must send money manually
        db.prepare("UPDATE withdrawals SET status='approved',reviewedBy=?,reviewedAt=?,b2cError=? WHERE id=?")
          .run(req.user.id, now(), b2cErr.message, wd.id);
        db.prepare('UPDATE users SET totalWithdrawn=totalWithdrawn+? WHERE id=?').run(wd.net, wd.userId);
        db.prepare("UPDATE transactions SET status='completed' WHERE userId=? AND type='withdrawal' AND status='pending'").run(wd.userId);
        addNotif(wd.userId, `✅ Withdrawal of KES ${(+wd.net).toFixed(2)} approved. Being sent to ${wd.address}.`, 'success');

        return res.status(200).json({
          success: true,
          b2c: false,
          warning: `B2C auto-payment failed: ${b2cErr.message}. Withdrawal marked approved — please send KES ${wd.net} manually to ${wd.address}.`
        });
      }

    } else {
      // ── MANUAL APPROVAL (no B2C config or non-M-Pesa method) ──
      db.prepare("UPDATE withdrawals SET status='approved',reviewedBy=?,reviewedAt=? WHERE id=?")
        .run(req.user.id, now(), wd.id);
      db.prepare('UPDATE users SET totalWithdrawn=totalWithdrawn+? WHERE id=?').run(wd.net, wd.userId);
      db.prepare("UPDATE transactions SET status='completed' WHERE userId=? AND type='withdrawal' AND status='pending'").run(wd.userId);
      addNotif(wd.userId, `✅ Withdrawal of KES ${(+wd.net).toFixed(2)} approved and sent to ${wd.address}!`, 'success');

      return res.json({
        success: true,
        b2c: false,
        message: b2cConfigured
          ? `Approved. Note: B2C only works for M-Pesa withdrawals.`
          : `Approved. B2C not configured — please send KES ${wd.net} manually to ${wd.address}.`
      });
    }

  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── B2C RESULT CALLBACK ────────────────────────────
// Safaricom calls this when B2C payment completes/fails
app.post('/api/mpesa/b2c/result', (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  try {
    const result = req.body?.Result;
    if (!result) return;

    const convId      = result.ConversationID;
    const origConvId  = result.OriginatorConversationID;
    const resultCode  = result.ResultCode;
    const resultDesc  = result.ResultDesc;

    // Extract result parameters
    let transactionId = null, amount = null, phone = null, charges = null;
    if (result.ResultParameters?.ResultParameter) {
      const params = result.ResultParameters.ResultParameter;
      const get = name => params.find(p => p.Key === name)?.Value;
      transactionId = get('TransactionID');
      amount        = get('TransactionAmount');
      phone         = get('ReceiverPartyPublicName');
      charges       = get('B2CChargesPaidAccountAvailableFunds');
    }

    // Find matching b2c log by conversationId
    const log = db.prepare('SELECT * FROM b2c_logs WHERE conversationId=?').get(convId);
    if (!log) { console.log('⚠️ B2C result for unknown conv:', convId); return; }

    // Update b2c log
    db.prepare(`UPDATE b2c_logs SET
      status=?, resultCode=?, resultDesc=?, transactionId=?,
      transactionAmount=?, rawResult=?, completedAt=?
      WHERE conversationId=?`)
      .run(
        resultCode === 0 ? 'success' : 'failed',
        resultCode, resultDesc, transactionId,
        amount, JSON.stringify(req.body), now(),
        convId
      );

    // Find the withdrawal
    const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(log.withdrawalId);
    if (!wd) return;

    if (resultCode === 0) {
      // ✅ Payment successful
      console.log(`✅ B2C success: ${transactionId} — KES ${amount} to ${phone}`);
      db.prepare("UPDATE withdrawals SET status='approved',b2cTransactionId=? WHERE id=?")
        .run(transactionId, wd.id);
      db.prepare('UPDATE users SET totalWithdrawn=totalWithdrawn+? WHERE id=?')
        .run(wd.net, wd.userId);
      db.prepare("UPDATE transactions SET status='completed' WHERE userId=? AND type='withdrawal' AND status='pending'")
        .run(wd.userId);
      addNotif(wd.userId,
        `✅ KES ${(+wd.net).toFixed(2)} sent to your M-Pesa (${transactionId})! Check your phone.`,
        'success');

    } else {
      // ❌ Payment failed — refund user
      console.log(`❌ B2C failed: ${resultDesc}`);
      db.prepare("UPDATE withdrawals SET status='failed',rejectionReason=? WHERE id=?")
        .run(resultDesc, wd.id);
      db.prepare('UPDATE users SET balance=balance+? WHERE id=?')
        .run(wd.amount, wd.userId); // refund full amount
      db.prepare("UPDATE transactions SET status='failed' WHERE userId=? AND type='withdrawal' AND status='pending'")
        .run(wd.userId);
      addNotif(wd.userId,
        `❌ Withdrawal failed: ${resultDesc}. KES ${(+wd.amount).toFixed(2)} has been refunded to your balance.`,
        'error');
    }

  } catch(e) { console.error('B2C result error:', e.message); }
});

// ── B2C TIMEOUT CALLBACK ───────────────────────────
// Called if Safaricom can't process in time
app.post('/api/mpesa/b2c/timeout', (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  try {
    const convId = req.body?.Result?.ConversationID;
    if (!convId) return;
    const log = db.prepare('SELECT * FROM b2c_logs WHERE conversationId=?').get(convId);
    if (!log) return;
    db.prepare("UPDATE b2c_logs SET status='timeout',completedAt=? WHERE conversationId=?").run(now(), convId);
    const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(log.withdrawalId);
    if (!wd) return;
    // Refund on timeout
    db.prepare("UPDATE withdrawals SET status='failed',rejectionReason='M-Pesa timeout' WHERE id=?").run(wd.id);
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(wd.amount, wd.userId);
    addNotif(wd.userId,
      `⚠️ Withdrawal timed out. KES ${(+wd.amount).toFixed(2)} refunded to your balance. Please try again.`,
      'error');
  } catch(e) { console.error('B2C timeout error:', e.message); }
});

// ── GET B2C LOGS (admin) ───────────────────────────
app.get('/api/admin/b2c-logs', authAdmin, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM b2c_logs ORDER BY createdAt DESC LIMIT 100').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/withdrawals/:id/reject', authAdmin, (req, res) => {
  try {
    const { reason } = req.body;
    const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
    if (!wd) return res.status(404).json({ error: 'Not found' });
    db.prepare("UPDATE withdrawals SET status='rejected',rejectionReason=?,reviewedBy=?,reviewedAt=? WHERE id=?").run(reason||'Rejected',req.user.id,now(),wd.id);
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(wd.amount,wd.userId);
    addNotif(wd.userId,`❌ Withdrawal rejected. KES ${(+wd.amount).toFixed(2)} refunded.`,'error');
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/investments', authAdmin, (req, res) => {
  try {
    res.json(db.prepare(`SELECT i.*,u.firstName||' '||u.lastName as userName FROM investments i LEFT JOIN users u ON i.userId=u.id ORDER BY i.startDate DESC`).all());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/transactions', authAdmin, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM transactions ORDER BY createdAt DESC LIMIT 500').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/plans', authAdmin, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM plans ORDER BY minAmount ASC').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/plans', authAdmin, (req, res) => {
  try {
    const { name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular } = req.body;
    if (!name||!roi||!period||!minAmount||!maxAmount) return res.status(400).json({ error: 'Fill all required fields' });
    const id = uuidv4();
    db.prepare(`INSERT INTO plans (id,name,roi,period,minAmount,maxAmount,referralBonus,color,description,popular,active,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`)
      .run(id,name,roi,period,minAmount,maxAmount,referralBonus||5,color||'#00e676',description||'',popular?1:0,now());
    res.json({ success:true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/plans/:id', authAdmin, (req, res) => {
  try {
    const p = req.body;
    db.prepare(`UPDATE plans SET name=COALESCE(?,name),roi=COALESCE(?,roi),period=COALESCE(?,period),minAmount=COALESCE(?,minAmount),maxAmount=COALESCE(?,maxAmount),referralBonus=COALESCE(?,referralBonus),color=COALESCE(?,color),description=COALESCE(?,description),active=COALESCE(?,active) WHERE id=?`)
      .run(p.name||null,p.roi||null,p.period||null,p.minAmount||null,p.maxAmount||null,p.referralBonus||null,p.color||null,p.description||null,p.active!=null?p.active:null,req.params.id);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/plans/:id', authAdmin, (req, res) => {
  try { db.prepare('DELETE FROM plans WHERE id=?').run(req.params.id); res.json({ success:true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/settings', authAdmin, (req, res) => {
  try { res.json(Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(r=>[r.key,r.value]))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/settings', authAdmin, (req, res) => {
  try {
    const ins = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
    Object.entries(req.body).forEach(([k,v]) => { if(v!==undefined&&v!=='') ins.run(k,String(v)); });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/broadcast', authAdmin, (req, res) => {
  try {
    const { userId, message, type } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    if (userId) { addNotif(userId,message,type||'info'); }
    else { db.prepare("SELECT id FROM users WHERE role!='admin'").all().forEach(m=>addNotif(m.id,message,type||'info')); }
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/adjust-balance', authAdmin, (req, res) => {
  try {
    const { userId, amount, type, reason } = req.body;
    if (!userId||!amount||!type||!reason) return res.status(400).json({ error: 'Fill all fields' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const delta = type==='credit' ? amount : -amount;
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(delta,userId);
    addTx(userId,'bonus',Math.abs(amount),`Admin ${type}: ${reason}`,'completed');
    addNotif(userId,`Admin ${type} of KES ${(+amount).toFixed(2)}: ${reason}`,'info');
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/mpesa-logs', authAdmin, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM mpesa_logs ORDER BY processedAt DESC LIMIT 100').all()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════
//  PROFIT ENGINE
// ══════════════════════════════════════════════════
function creditProfits() {
  try {
    const active = db.prepare("SELECT * FROM investments WHERE status='active'").all();
    let credited = 0;
    for (const inv of active) {
      try {
        const nowTs  = Date.now();
        const endTs  = new Date(inv.endDate).getTime();
        const lastTs = new Date(inv.lastCredited || inv.startDate).getTime();
      let credit = (inv.amount * (inv.roi/100) / 86400) * ((nowTs - lastTs) / 1000);

const maxProfit = inv.amount * (inv.roi/100) * inv.period;

if ((inv.earned + credit) > maxProfit) {
  credit = maxProfit - inv.earned;
};
        if (nowTs >= endTs) {
          const total = (inv.earned||0) + credit;
          db.prepare("UPDATE investments SET status='completed',earned=?,lastCredited=? WHERE id=?").run(total,now(),inv.id);
          db.prepare('UPDATE users SET balance=balance+?,totalProfits=totalProfits+? WHERE id=?').run(inv.amount+total,total,inv.userId);
          addTx(inv.userId,'profit',total,`${inv.planName} matured — profit + principal credited`,'completed');
          addNotif(inv.userId,`🎉 ${inv.planName} matured! KES ${total.toFixed(2)} profit credited!`,'success');
          credited++;
        } else {
          db.prepare("UPDATE investments SET earned=earned+?,lastCredited=? WHERE id=?").run(credit,now(),inv.id);
        }
      } catch {}
    }
    if (credited > 0) console.log(`💰 Credited ${credited} matured investment(s)`);
  } catch(e) { console.error('Profit engine error:', e.message); }
}
creditProfits();
setInterval(creditProfits, 10 * 60 * 1000);

// ══════════════════════════════════════════════════
//  AUTO DEPOSIT CHECKER (every 30 seconds)
//  Checks pending STK Push deposits with Safaricom
//  and auto-credits balance if payment confirmed
// ══════════════════════════════════════════════════
async function autoCheckDeposits() {
  try {
    // Only check deposits pending for more than 30s and less than 10 mins
    const pending = db.prepare(`
      SELECT * FROM deposits
      WHERE status='pending'
      AND mpesaCheckoutId IS NOT NULL
      AND mpesaCheckoutId != ''
      AND createdAt > datetime('now', '-10 minutes')
      AND createdAt < datetime('now', '-30 seconds')
    `).all();

    if (!pending.length) return;

    for (const dep of pending) {
      try {
        const token = await getMpesaToken();
        const { password, timestamp } = getMpesaPassword();

        const result = await axios.post(
          `${MPESA_BASE}/mpesa/stkpushquery/v1/query`,
          {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: dep.mpesaCheckoutId
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );

        const rc = result.data.ResultCode;

        if (rc === 0 || rc === '0') {
          // ✅ Payment confirmed — credit balance
       if (dep.status === 'approved') continue;
          const amount = dep.amount;
          db.prepare("UPDATE deposits SET status='approved',reviewedAt=? WHERE id=?")
            .run(now(), dep.id);
          db.prepare('UPDATE users SET balance=balance+? WHERE id=?')
            .run(amount, dep.userId);
          db.prepare("UPDATE transactions SET status='completed' WHERE userId=? AND type='deposit' AND status='pending'")
            .run(dep.userId);
          addNotif(dep.userId, `✅ Deposit of KES ${(+amount).toFixed(2)} confirmed and credited!`, 'success');
          console.log(`✅ Auto-confirmed deposit ${dep.id} — KES ${amount} for user ${dep.userId}`);

          // Handle referral commission
          const user = db.prepare('SELECT * FROM users WHERE id=?').get(dep.userId);
          if (user?.referredBy) {
            const ref = db.prepare('SELECT * FROM referrals WHERE refereeId=?').get(dep.userId);
            if (ref) {
              const commission = amount * (parseFloat(getSetting('referralRate')||5) / 100);
              db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(commission, user.referredBy);
              db.prepare('UPDATE referrals SET earnings=earnings+? WHERE id=?').run(commission, ref.id);
              addTx(user.referredBy, 'referral', commission, `Referral commission from ${user.firstName}`, 'completed');
              addNotif(user.referredBy, `💰 Referral commission KES ${commission.toFixed(2)} from ${user.firstName}!`, 'success');
            }
          }

        } else if (rc === 1032 || rc === '1032') {
          // Cancelled by user
          db.prepare("UPDATE deposits SET status='failed',rejectionReason='Cancelled by user' WHERE id=?").run(dep.id);
          addNotif(dep.userId, `❌ M-Pesa payment was cancelled. Try again.`, 'error');

        } else if (rc === 1037 || rc === '1037') {
          // Timeout — mark failed
          db.prepare("UPDATE deposits SET status='failed',rejectionReason='Payment timed out' WHERE id=?").run(dep.id);
          addNotif(dep.userId, `❌ M-Pesa payment timed out. Please try again.`, 'error');
        }
        // Other codes = still processing, leave as pending

      } catch(depErr) {
        // Safaricom query failed — leave deposit as pending, try next cycle
        console.log(`⚠️ Could not query deposit ${dep.id}: ${depErr.message}`);
      }
    }
  } catch(e) {
    console.error('Auto deposit checker error:', e.message);
  }
}

// Run auto checker every 30 seconds
autoCheckDeposits();
setInterval(autoCheckDeposits, 30 * 1000);

// Also add a new API endpoint the dashboard polls for instant balance updates
app.get('/api/user/balance', authUser, (req, res) => {
  try {
    const user = db.prepare('SELECT balance,totalInvested,totalProfits,totalWithdrawn FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const pendingDeps = db.prepare("SELECT COUNT(*) as c FROM deposits WHERE userId=? AND status='pending'").get(req.user.id).c;
    res.json({ ...user, pendingDeps });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_tx_userId ON transactions(userId);
  CREATE INDEX IF NOT EXISTS idx_dep_status ON deposits(status);
  CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status);
`);
// ══════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║       PESA GROW BACKEND RUNNING         ║
╠══════════════════════════════════════════╣
║  PORT:   ${String(PORT).padEnd(32)}║
║  Admin:  admin@pesagrow.co.ke           ║
║  Pass:   Admin@2024                     ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
