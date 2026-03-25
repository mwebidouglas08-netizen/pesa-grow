// ─────────────────────────────────────────
// IMPORTS (FIXED — ALL REQUIRED MODULES)
// ─────────────────────────────────────────
const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");

// ─────────────────────────────────────────
// APP INIT
// ─────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────
// MIDDLEWARE (CLEANED)
// ─────────────────────────────────────────
app.set("trust proxy", 1);

app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));

app.use(express.json());

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300
});
app.use("/api/", limiter);

// ─────────────────────────────────────────
// STATIC + PWA FIXES
// ─────────────────────────────────────────
app.get("/sw.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "public", "sw.js"));
});

app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/manifest+json");
  res.sendFile(path.join(__dirname, "public", "manifest.json"));
});

app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────
// BASIC HEALTH CHECK
// ─────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("Pesa Grow API running...");
});

// ─────────────────────────────────────────
// DATABASE (SAFE INIT)
// ─────────────────────────────────────────
const db = new Database(process.env.DB_PATH || "./pesagrow.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─────────────────────────────────────────
// HELPERS (ESSENTIAL ONLY)
// ─────────────────────────────────────────
const now = () => new Date().toISOString();

function sanitizePhone(phone) {
  phone = String(phone).replace(/\D/g, "");
  if (phone.startsWith("0")) phone = "254" + phone.slice(1);
  if (!phone.startsWith("254")) phone = "254" + phone;
  return phone;
}

// ─────────────────────────────────────────
// ENV VALIDATION (CRASH FIX)
// ─────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET missing");
  process.exit(1);
}

// ─────────────────────────────────────────
// M-PESA CONFIG (FIXED)
// ─────────────────────────────────────────
const MPESA_BASE = process.env.MPESA_ENV === "live"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

async function getMpesaToken() {
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

// ─────────────────────────────────────────
// STK PUSH (FIXED)
// ─────────────────────────────────────────
app.post("/api/mpesa/stk-push", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount required" });
    }

    const token = await getMpesaToken();
    const { password, timestamp } = getPassword();

    const response = await axios.post(
      `${MPESA_BASE}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerBuyGoodsOnline",
        Amount: Math.ceil(amount),
        PartyA: sanitizePhone(phone),
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: sanitizePhone(phone),
        CallBackURL: `${process.env.BASE_URL}/api/mpesa/callback`,
        AccountReference: "PesaGrow",
        TransactionDesc: "Deposit"
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    res.json(response.data);

  } catch (err) {
    console.error("STK ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.errorMessage || err.message
    });
  }
});

// ─────────────────────────────────────────
// CALLBACK (REQUIRED FOR STK)
// ─────────────────────────────────────────
app.post("/api/mpesa/callback", (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  console.log("MPESA CALLBACK:", JSON.stringify(req.body, null, 2));
});

// ─────────────────────────────────────────
// START SERVER (ONLY ONCE — CRITICAL FIX)
// ─────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});

module.exports = app;
