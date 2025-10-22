import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";
import os from "os";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ✅ Utility helpers
const cleanWebsite = (url) => {
  if (!url || url === "N/A") return "N/A";
  if (url.startsWith("https://www.google.com/maps/")) return "N/A";
  if (url.startsWith("https://www.google.com/url?")) {
    const match = url.match(/q=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : "N/A";
  }
  return url.trim();
};

const cleanPhone = (phone) => {
  if (!phone || phone === "N/A") return "N/A";
  return phone.replace(/[^\d+]/g, "").trim();
};

const extractKeywordFromUrl = (url) => {
  try {
    const match =
      url.match(/\/maps\/search\/([^/@?]+)/) ||
      url.match(/\/maps\/place\/([^/@?]+)/);
    if (match && match[1])
      return decodeURIComponent(match[1]).replace(/[^\w]+/g, "_").toLowerCase();

    const coord = url.match(/@([\d.,]+)/);
    if (coord && coord[1]) return `coords_${coord[1].replace(/[^\d]+/g, "_")}`;
    return "maps_data";
  } catch {
    return "maps_data";
  }
};

// ✅ Main scraper
export async function scrapeGoogleMaps(searchUrl) {
  console.log("🔍 Starting Google Maps scraper...");
  console.log(`🌐 Target URL: ${searchUrl}`);

  const isProd =
    process.env.RENDER === "true" || process.env.NODE_ENV === "production";

  const TMP_DIR = path.join(os.tmpdir(), "maps-scraper");
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  let browser;

  try {
    if (isProd) {
      console.log("🧊 Using Sparticuz Chromium (Render/EC2)");
      const executablePath = await chromium.executablePath();

      browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--single-process",
          "--no-zygote",
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });
    } else {
      console.log("💻 Using local Chromium");
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }
  } catch (err) {
    console.error("❌ Browser launch failed:", err);
    throw err;
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  try {
    console.log("⏳ Loading page...");
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 90000 });
    await page.waitForSelector(".Nv2PK", { timeout: 90000 });
  } catch (err) {
    console.error("❌ Google Maps page failed to load:", err.message);
    await browser.close();
    throw new Error("Page did not load correctly");
  }

  console.log("📜 Scrolling...");
  let prevCount = 0,
    stableRounds = 0;

  while (stableRounds < 5) {
    await page.evaluate(() => {
      const scrollContainer = document.querySelector(".m6QErb[aria-label]");
      if (scrollContainer)
        scrollContainer.scrollBy(0, scrollContainer.scrollHeight);
    });
    await delay(2500);

    const count = await page.$$eval(".Nv2PK", (els) => els.length);
    if (count > prevCount) {
      console.log(`Loaded ${count} results...`);
      stableRounds = 0;
    } else {
      stableRounds++;
    }
    prevCount = count;
  }

  console.log(`✅ Total found: ${prevCount}`);
  const results = [];
  let skipped = 0;

  for (let i = 0; i < prevCount; i++) {
    console.log(`➡️ Scraping place ${i + 1} of ${prevCount}...`);
    const places = await page.$$(".Nv2PK");
    if (!places[i]) continue;

    try {
      await places[i].hover();
      await places[i].click();
      await delay(4000);

      const data = await page.evaluate(() => {
        const t = (sel) => document.querySelector(sel)?.innerText?.trim() || "";
        const h = (sel) => document.querySelector(sel)?.href?.trim() || "";

        const clean = (txt) =>
          txt
            ? txt
                .replace(/[\uE000-\uF8FF]/g, "")
                .replace(/\s+/g, " ")
                .trim()
            : "";

        const name = clean(
          t("h1.DUwDvf") || t("div.qBF1Pd") || t("div.fontHeadlineSmall")
        );
        const phone = clean(
          t("button[aria-label*='Phone']") ||
            t("a[href^='tel:']") ||
            t('[data-item-id^="phone:tel:"]')
        );
        const address = clean(
          t("button[aria-label*='Address']") ||
            t('[data-item-id="address"]') ||
            t("div.W4Efsd span[aria-label*='Address']")
        );
        const website =
          h("a[data-item-id^='authority']") ||
          h("a[aria-label*='Website']") ||
          h("a[href*='https://']");

        return { name, phone, address, website: website || "N/A" };
      });

      if (!data.phone) {
        skipped++;
        console.log(`⏭️ Skipped (no phone): ${data.name || "Unknown"}`);
        await page.keyboard.press("Escape");
        await delay(1000);
        continue;
      }

      data.phone = cleanPhone(data.phone);
      data.website = cleanWebsite(data.website);

      results.push({
        Name: data.name || "N/A",
        Phone: data.phone,
        Address: data.address || "N/A",
        Website: data.website,
      });

      console.log(`✅ Saved: ${data.name} | ${data.phone}`);
      await page.keyboard.press("Escape");
      await delay(1000);
    } catch (err) {
      console.log(`⚠️ Error scraping place ${i + 1}: ${err.message}`);
    }
  }

  // ✅ Save CSV
  const csv =
    "Name,Phone,Address,Website\n" +
    results
      .map(
        (r) =>
          `"${r.Name.replace(/"/g, '""')}","${r.Phone}","${r.Address.replace(
            /"/g,
            '""'
          )}","${r.Website}"`
      )
      .join("\n");

  const keyword = extractKeywordFromUrl(searchUrl);
  const fileName = `maps_${keyword}_${new Date()
    .toISOString()
    .split("T")[0]}.csv`;
  const filePath = path.join(TMP_DIR, fileName);
  fs.writeFileSync(filePath, csv, "utf8");

  console.log("🧾 Summary:");
  console.log(`Total found: ${prevCount}`);
  console.log(`Saved (with phone): ${results.length}`);
  console.log(`Skipped (no phone): ${skipped}`);
  console.log(`File saved: ${filePath}`);

  await browser.close();
  return filePath;
}

// ✅ CLI entrypoint
if (process.argv[2]) {
  const url = process.argv[2];
  scrapeGoogleMaps(url).catch((err) => {
    console.error("🔥 Fatal error:", err);
    process.exit(1);
  });
} else {
  console.error("❌ No URL provided.");
}
