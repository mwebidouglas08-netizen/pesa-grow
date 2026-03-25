// ====================== IMPORTS ======================
const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");

// ====================== INIT ======================
const app = express();
const PORT = process.env.PORT || 5000;

// ====================== MIDDLEWARE ======================
app.set("trust proxy", 1);

app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(express.json());

app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
}));

// ====================== STATIC ======================
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.send("Pesa Grow API running...");
});

// ====================== DATABASE ======================
const db = new Database("./pesagrow.db");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password TEXT,
  balance REAL DEFAULT 0,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  userId TEXT,
  amount REAL,
  status TEXT,
  mpesaCheckoutId TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  userId TEXT,
  amount REAL,
  status TEXT,
  createdAt TEXT
);
`);

// ====================== HELPERS ======================
const now = () => new Date().toISOString();

function sanitizePhone(phone) {
  phone = String(phone).replace(/\D/g, "");
  if (phone.startsWith("0")) phone = "254" + phone.slice(1);
  if (!phone.startsWith("254")) phone = "254" + phone;
  return phone;
}

// ====================== AUTH ======================
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ====================== AUTH ROUTES ======================
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Missing fields" });

    const hash = bcrypt.hashSync(password, 10);

    const id = uuidv4();

    db.prepare(`
      INSERT INTO users (id,email,password,createdAt)
      VALUES (?,?,?,?)
    `).run(id, email, hash, now());

    const token = jwt.sign({ id }, JWT_SECRET);

    res.json({ token });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);

  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user.id }, JWT_SECRET);

  res.json({ token });
});

// ====================== M-PESA ======================
const MPESA_BASE = process.env.MPESA_ENV === "live"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

async function getToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const res = await axios.get(
    `${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return res.data.access_token;
}

function getPassword() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);

  const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;

  return {
    password: Buffer.from(raw).toString("base64"),
    timestamp
  };
}

// ====================== STK PUSH ======================
app.post("/api/mpesa/stk", auth, async (req, res) => {
  try {
    const { phone, amount } = req.body;

    const token = await getToken();
    const { password, timestamp } = getPassword();

    const depositId = uuidv4();

    db.prepare(`
      INSERT INTO deposits (id,userId,amount,status,createdAt)
      VALUES (?,?,?,?,?)
    `).run(depositId, req.user.id, amount, "pending", now());

    const response = await axios.post(
      `${MPESA_BASE}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerBuyGoodsOnline",
        Amount: amount,
        PartyA: sanitizePhone(phone),
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: sanitizePhone(phone),
        CallBackURL: `${process.env.BASE_URL}/api/mpesa/callback`,
        AccountReference: "PesaGrow",
        TransactionDesc: "Deposit"
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    db.prepare(`
      UPDATE deposits SET mpesaCheckoutId=? WHERE id=?
    `).run(response.data.CheckoutRequestID, depositId);

    res.json(response.data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====================== CALLBACK ======================
app.post("/api/mpesa/callback", (req, res) => {
  res.json({ ResultCode: 0 });

  const data = req.body?.Body?.stkCallback;
  if (!data) return;

  const checkoutId = data.CheckoutRequestID;

  if (data.ResultCode === 0) {
    const deposit = db.prepare(`
      SELECT * FROM deposits WHERE mpesaCheckoutId=?
    `).get(checkoutId);

    if (!deposit) return;

    db.prepare(`
      UPDATE deposits SET status='completed' WHERE id=?
    `).run(deposit.id);

    db.prepare(`
      UPDATE users SET balance=balance+? WHERE id=?
    `).run(deposit.amount, deposit.userId);
  }
});

// ====================== WITHDRAW ======================
app.post("/api/withdraw", auth, (req, res) => {
  const { amount } = req.body;

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);

  if (user.balance < amount)
    return res.status(400).json({ error: "Insufficient balance" });

  db.prepare(`
    UPDATE users SET balance=balance-? WHERE id=?
  `).run(amount, user.id);

  db.prepare(`
    INSERT INTO withdrawals (id,userId,amount,status,createdAt)
    VALUES (?,?,?,?,?)
  `).run(uuidv4(), user.id, amount, "pending", now());

  res.json({ success: true });
});

// ====================== START ======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
