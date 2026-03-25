const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

/**
 * -----------------------
 * SECURITY + MIDDLEWARE
 * -----------------------
 */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * -----------------------
 * IN-MEMORY USER STORE (TEMP FIX)
 * Replace with DB later (Mongo/Postgres)
 * -----------------------
 */
const users = [];

/**
 * -----------------------
 * HEALTH CHECK (IMPORTANT)
 * -----------------------
 */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend is running",
  });
});

/**
 * -----------------------
 * REGISTER
 * -----------------------
 */
app.post("/api/register", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }

    const exists = users.find(u => u.email === email);

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    const newUser = {
      id: Date.now(),
      email,
      password, // NOTE: plain text for now (upgrade later)
    };

    users.push(newUser);

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      user: {
        id: newUser.id,
        email: newUser.email,
      },
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * -----------------------
 * LOGIN
 * -----------------------
 */
app.post("/api/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }

    const user = users.find(
      u => u.email === email && u.password === password
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: "demo-token-" + user.id,
      user: {
        id: user.id,
        email: user.email,
      },
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * -----------------------
 * STATIC FRONTEND
 * -----------------------
 */
app.use(express.static(path.join(__dirname, "public")));

/**
 * FIX: correct admin routing
 */
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/**
 * FIX: homepage
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * -----------------------
 * CRITICAL FIX:
 * Prevent HTML responses on API routes
 * -----------------------
 */
app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({
      success: false,
      message: "API endpoint not found",
    });
  }

  return res.status(404).send("Not found");
});

/**
 * -----------------------
 * GLOBAL ERROR HANDLER
 * -----------------------
 */
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);

  res.status(500).json({
    success: false,
    message: "Server crashed unexpectedly",
  });
});

/**
 * -----------------------
 * START SERVER
 * -----------------------
 */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
