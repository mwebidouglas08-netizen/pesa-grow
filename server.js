require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================= DATABASE SAFETY =================
const MONGO_URI = process.env.MONGO_URI;

// DO NOT CRASH SERVER IF DB FAILS
mongoose
  .connect(MONGO_URI || "mongodb://127.0.0.1:27017/fallback")
  .then(() => console.log("DB connected"))
  .catch((err) => console.log("DB error:", err.message));

// ================= MODEL =================
const UserSchema = new mongoose.Schema(
  {
    email: String,
    password: String,
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);

// ================= HEALTH CHECK =================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ================= REGISTER =================
app.post("/api/auth/register", async (req, res) => {
  try {
    console.log("REGISTER BODY:", req.body);

    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: "Missing email or password",
        received: req.body,
      });
    }

    const exists = await User.findOne({ email });

    if (exists) {
      return res.status(400).json({ error: "User already exists" });
    }

    const user = await User.create({ email, password });

    return res.json({
      message: "User created",
      userId: user._id,
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// ================= LOGIN =================
app.post("/api/auth/login", async (req, res) => {
  try {
    console.log("LOGIN BODY:", req.body);

    const { email, password } = req.body || {};

    const user = await User.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    return res.json({
      message: "Login successful",
      userId: user._id,
    });
 catch (err) {
  console.error("🔥 FULL BACKEND ERROR:", err);

  return res.status(500).json({
    error: err.message,
    stack: err.stack,
  });
}
  
});

// ================= FRONTEND =================
const publicPath = path.join(__dirname, "public");

app.use(express.static(publicPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicPath, "admin.html"));
});

// ================= DEBUG CATCH =================
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

// ================= START =================
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
