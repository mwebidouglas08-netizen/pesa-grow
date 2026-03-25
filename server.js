require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

// SAFE IMPORT (prevents crash if not installed)
let rateLimit;
try {
  rateLimit = require("express-rate-limit");
} catch (e) {
  console.warn("express-rate-limit not installed, skipping...");
}

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

if (rateLimit) {
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
    })
  );
}

// ================= ENV VARIABLES =================
const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI;

// ================= DATABASE CONNECTION =================
async function connectDB() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI is missing in environment variables");
    return;
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("DB ERROR:", err.message);

    // retry after delay instead of crashing
    setTimeout(connectDB, 5000);
  }
}

// call connection
connectDB();

// ================= MODELS =================
const transactionSchema = new mongoose.Schema(
  {
    phone: String,
    amount: Number,
    status: { type: String, default: "pending" },
    reference: String,
  },
  { timestamps: true }
);

const Transaction = mongoose.model("Transaction", transactionSchema);

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.send("🚀 Server is running...");
});

// STK PUSH SIMULATION / REAL HOOK
app.post("/stk", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Missing phone or amount" });
    }

    const trx = await Transaction.create({
      phone,
      amount,
      reference: "TX-" + Date.now(),
    });

    res.json({
      message: "STK initiated",
      transaction: trx,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "STK failed" });
  }
});

// CALLBACK (Daraja will hit this)
app.post("/callback", (req, res) => {
  console.log("📩 CALLBACK RECEIVED:", JSON.stringify(req.body, null, 2));

  // TODO: update transaction status here

  res.json({ message: "Callback received" });
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
const path = require("path");

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Explicit routes (important for Railway)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
