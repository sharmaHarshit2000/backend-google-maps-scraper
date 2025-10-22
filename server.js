import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import cors from "cors";
import { spawn } from "child_process";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// ✅ Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ CORS setup
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// ✅ Temp directory
const TMP_DIR = path.join(os.tmpdir(), "maps-scraper");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ✅ POST /scrape
app.post("/scrape", (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Missing query or URL" });

  const url = query.startsWith("http")
    ? query
    : `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;

  console.log(`🚀 Starting scrape for: ${url}`);

  // Run as a subprocess for memory safety
  const scraper = spawn("node", [path.join(__dirname, "scrape-maps.js"), url], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let errorOutput = "";

  scraper.stdout.on("data", (data) => console.log(data.toString()));
  scraper.stderr.on("data", (data) => {
    errorOutput += data.toString();
    console.error(data.toString());
  });

  scraper.on("close", () => {
    const files = fs
      .readdirSync(TMP_DIR)
      .filter((f) => f.endsWith(".csv"))
      .sort(
        (a, b) =>
          fs.statSync(path.join(TMP_DIR, b)).mtimeMs -
          fs.statSync(path.join(TMP_DIR, a)).mtimeMs
      );

    const latest = files[0];

    if (latest) {
      console.log(`✅ Scrape completed → ${latest}`);
      return res.json({
        success: true,
        message: "✅ Scraping completed successfully",
        file: latest,
        downloadUrl: `/download/${encodeURIComponent(latest)}`,
      });
    }

    console.error("❌ No file generated:", errorOutput);
    res.status(500).json({
      success: false,
      message: "❌ Scraping failed",
      error: errorOutput || "No CSV file generated",
    });
  });
});

// ✅ GET /download
app.get("/download/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.file);
  if (!fs.existsSync(filePath)) {
    console.error("❌ File not found:", filePath);
    return res.status(404).send("File not found");
  }

  res.download(filePath, (err) => {
    if (!err) fs.unlinkSync(filePath);
  });
});

// ✅ Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🌐 Frontend allowed: ${FRONTEND_URL}`);
});
