require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

// OPTIONAL SAFE RATE LIMIT (no external dependency)
const rateLimitStore = {};

const simpleRateLimiter = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();

  if (!rateLimitStore[ip]) {
    rateLimitStore[ip] = { count: 1, time: now };
    return next();
  }

  const diff = now - rateLimitStore[ip].time;

  // reset every 1 minute
  if (diff > 60000) {
    rateLimitStore[ip] = { count: 1, time: now };
    return next();
  }

  rateLimitStore[ip].count++;

  if (rateLimitStore[ip].count > 60) {
    return res.status(429).json({ msg: "Too many requests" });
  }

  next();
};

const app = express();

// middleware
app.use(express.json());
app.use(cors());
app.use(simpleRateLimiter);

// ================= DATABASE =================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => {
    console.error("DB ERROR:", err.message);
    process.exit(1);
  });

// ================= ROUTES =================

// HEALTH CHECK
app.get("/", (req, res) => {
  res.send("API running...");
});

// ================= AUTH =================
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const UserSchema = new mongoose.Schema({
  email: String,
  password: String
});

const User = mongoose.model("User", UserSchema);

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      password: hashed
    });

    res.json(user);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ msg: "User not found" });

    const match = await bcrypt.compare(password, user.password);

    if (!match) return res.status(400).json({ msg: "Invalid password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

    res.json({ token });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// ================= MPESA STK =================
const axios = require("axios");

const getMpesaToken = async () => {
  const res = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      auth: {
        username: process.env.MPESA_CONSUMER_KEY,
        password: process.env.MPESA_CONSUMER_SECRET
      }
    }
  );
  return res.data.access_token;
};

app.post("/api/stk/push", async (req, res) => {
  try {
    const token = await getMpesaToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, -3);

    const password = Buffer.from(
      process.env.MPESA_SHORTCODE +
        process.env.MPESA_PASSKEY +
        timestamp
    ).toString("base64");

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: req.body.amount || 1,
        PartyA: req.body.phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: req.body.phone,
        CallBackURL: process.env.BASE_URL + "/api/stk/callback",
        AccountReference: "PesaGrow",
        TransactionDesc: "Payment"
      },
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ msg: "STK Push failed" });
  }
});

// CALLBACK
app.post("/api/stk/callback", (req, res) => {
  console.log("MPESA CALLBACK:", JSON.stringify(req.body, null, 2));
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// ================= B2C =================
app.post("/api/b2c/send", async (req, res) => {
  try {
    const token = await getMpesaToken();

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest",
      {
        InitiatorName: "testapi",
        SecurityCredential: "YOUR_ENCRYPTED_CREDENTIAL",
        CommandID: "BusinessPayment",
        Amount: req.body.amount,
        PartyA: process.env.MPESA_SHORTCODE,
        PartyB: req.body.phone,
        Remarks: "Payment",
        QueueTimeOutURL: process.env.BASE_URL + "/timeout",
        ResultURL: process.env.BASE_URL + "/result",
        Occasion: "Payout"
      },
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ msg: "B2C failed" });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
