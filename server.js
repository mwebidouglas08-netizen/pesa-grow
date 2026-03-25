const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

/**
 * -----------------------
 * CORE MIDDLEWARE
 * -----------------------
 */
app.use(cors({
  origin: "*"
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * -----------------------
 * STATIC FRONTEND
 * -----------------------
 * Ensure your frontend files are in /public
 */
app.use(express.static(path.join(__dirname, "public")));

/**
 * -----------------------
 * BASIC HEALTH CHECK
 * -----------------------
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Server is running correctly"
  });
});

/**
 * -----------------------
 * EXAMPLE AUTH ROUTES
 * (Replace logic with your DB later)
 * -----------------------
 */

app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // TODO: replace with DB logic
    return res.status(200).json({
      success: true,
      message: "Account created successfully"
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: "demo-token"
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

/**
 * -----------------------
 * FRONTEND ROUTES
 * -----------------------
 * Fixes:
 * - Cannot GET /admin.html issue
 */
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * -----------------------
 * 404 HANDLER (IMPORTANT)
 * Prevents HTML being returned to API calls
 * -----------------------
 */
app.use((req, res) => {
  if (req.originalUrl.startsWith("/api")) {
    return res.status(404).json({
      success: false,
      message: "API route not found"
    });
  }

  res.status(404).send("Page not found");
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
    message: "Internal server error"
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
