const path = require("path");

// ================= API ROUTES FIRST =================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Example API safety fallback
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "API route not found" });
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
// fallback (critical for Railway)
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// ================= DATABASE =================
if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.log("DB ERROR:", err.message));
} else {
  console.log("⚠️ No MONGO_URI set (running without DB)");
}

// ================= START =================
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
