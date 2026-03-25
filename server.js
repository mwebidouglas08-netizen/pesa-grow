require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const app = express();

// ================= SAFE MIDDLEWARE =================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================= DATABASE =================
const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI || "")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB error:", err.message));

// ================= MODEL =================
const UserSchema = new mongoose.Schema(
  {
    email: String,
    password: String,
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);

// ================= API =================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const exists = await User.findOne({ email });

    if (exists) {
      return res.status(400).json({ error: "User exists" });
    }

    const user = await User.create({ email, password });

    return res.json({
      message: "Account created",
      userId: user._id,
    });
  } catch (err) {
    console.log("REGISTER ERROR:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(400).json({ error: "Invalid login" });
    }

    return res.json({
      message: "Login success",
      userId: user._id,
    });
  } catch (err) {
    console.log("LOGIN ERROR:", err.message);
    return res.status(500).json({ error: "Server error" });
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

// ================= START SERVER =================
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
