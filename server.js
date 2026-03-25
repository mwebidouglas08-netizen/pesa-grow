const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

/**
 * CORS - allow all for now (safe for dev + deployment debugging)
 */
app.use(cors({ origin: "*" }));

/**
 * JSON parsing (critical for register/login)
 */
async function login(email, password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();

  if (!data.success) {
    throw new Error(data.message);
  }

  localStorage.setItem("token", data.token);

  return data;
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * SIMPLE IN-MEMORY DB (replace later with MongoDB)
 */
const users = [];

/**
 * HEALTH CHECK
 */
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * REGISTER
 */
async function register(email, password) {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();

  if (!data.success) {
    throw new Error(data.message);
  }

  return data;
}
app.post("/api/register", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const exists = users.find(u => u.email === email);

  if (exists) {
    return res.status(409).json({ success: false, message: "User exists" });
  }

  users.push({ email, password });

  return res.json({ success: true, message: "Registered successfully" });
});

/**
 * LOGIN
 */
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const user = users.find(u => u.email === email && u.password === password);

  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  return res.json({
    success: true,
    token: "token-" + Date.now(),
  });
});

/**
 * STATIC FRONTEND
 */
app.use(express.static(path.join(__dirname, "public")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * ERROR SAFETY (prevents HTML leaking into API responses)
 */
app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  res.status(404).send("Not found");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server running on " + PORT));
