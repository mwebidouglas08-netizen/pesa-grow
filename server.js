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

// ================= DATABASE =================
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.log("❌ MONGO_URI missing in environment variables");
} else {
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.log("DB ERROR:", err.message));
}

// ================= MODELS =================
const userSchema = new mongoose.Schema(
  {
    email: String,
    password: String,
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

// ================= API ROUTES =================

// Health check (critical test endpoint)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const exists = await User.findOne({ email });

    if (exists) {
      return res.status(400).json({ error: "User already exists" });
    }

    const user = await User.create({ email, password });

    return res.json({
      message: "Account created successfully",
      user,
    });
  catch (err) {
  console.error("FULL ERROR:", err); // IMPORTANT
  return res.status(500).json({
    error: err.message,
    stack: err.stack,
  });
}

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    return res.json({
      message: "Login successful",
      userId: user._id,
    });
catch (err) {
  console.error("FULL ERROR:", err); // IMPORTANT
  return res.status(500).json({
    error: err.message,
    stack: err.stack,
  });
};

// ================= STATIC FRONTEND =================
const publicPath = path.join(__dirname, "public");

app.use(express.static(publicPath));

// frontend routes
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicPath, "admin.html"));
});

// ================= CRITICAL FIX =================
// ONLY catch NON-API routes
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({
      error: "API endpoint not found",
      path: req.originalUrl,
    });
  }
  next();
});

// ================= FINAL FRONTEND FALLBACK =================
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// ================= START SERVER =================
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
