import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";
import os from "os";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Utility functions
function cleanWebsite(url) {
  if (!url || url === "N/A") return "N/A";
  if (url.startsWith("https://www.google.com/maps/")) return "N/A";
  if (url.startsWith("https://www.google.com/url?")) {
    const match = url.match(/q=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : "N/A";
  }
  return url.trim();
}

function cleanPhone(phone) {
  if (!phone || phone === "N/A") return "N/A";
  return phone.replace(/[^\d+]/g, "").trim();
}

function extractKeywordFromUrl(url) {
  try {
    const searchMatch = url.match(/\/maps\/search\/([^/@?]+)/);
    if (searchMatch && searchMatch[1])
      return decodeURIComponent(searchMatch[1])
        .replace(/[^\w]+/g, "_")
        .toLowerCase();

    const placeMatch = url.match(/\/maps\/place\/([^/@?]+)/);
    if (placeMatch && placeMatch[1])
      return decodeURIComponent(placeMatch[1])
        .replace(/[^\w]+/g, "_")
        .toLowerCase();

    const coordMatch = url.match(/@([\d.,]+)/);
    if (coordMatch && coordMatch[1])
      return `coords_${coordMatch[1].replace(/[^\d]+/g, "_")}`;

    return "maps_data";
  } catch {
    return "maps_data";
  }
}

// Main scraper
async function scrapeGoogleMaps(searchUrl) {
  console.log("Starting Google Maps scraper...");
  console.log(`Opening URL: ${searchUrl}`);

  const isRender =
    process.env.RENDER === "true" || process.env.NODE_ENV === "production";

  // Temp directory
  const TMP_DIR = path.join(os.tmpdir(), "maps-scraper");
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  let browser;

  try {
    if (isRender) {
      console.log("Running on Render → using Sparticuz Chromium...");
      const executablePath = await chromium.executablePath();

      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless,
      });
    } else {
      console.log("Running locally → using Puppeteer’s bundled Chromium...");
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }
  } catch (err) {
    console.error("Failed to launch browser:", err);
    throw err;
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });

  console.log("Loading search results...");
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector(".Nv2PK", { timeout: 60000 });

  console.log("Scrolling results...");
  let prevCount = 0;
  let stableRounds = 0;

  while (stableRounds < 5) {
    await page.evaluate(() => {
      const scrollContainer = document.querySelector(".m6QErb[aria-label]");
      if (scrollContainer)
        scrollContainer.scrollBy(0, scrollContainer.scrollHeight);
    });
    await delay(2500);

    const currentCount = await page.$$eval(".Nv2PK", (els) => els.length);
    if (currentCount > prevCount) {
      console.log(`Loaded ${currentCount} results...`);
      stableRounds = 0;
    } else {
      stableRounds++;
    }
    prevCount = currentCount;
  }

  console.log(`Finished scrolling. Total results: ${prevCount}`);

  const results = [];
  let skipped = 0;

  for (let i = 0; i < prevCount; i++) {
    console.log(`Scraping place ${i + 1} of ${prevCount}...`);
    const places = await page.$$(".Nv2PK");
    if (!places[i]) continue;

    try {
      await places[i].hover();
      await places[i].click();
      await delay(4500);

      const data = await page.evaluate(() => {
        const getText = (sel) =>
          document.querySelector(sel)?.innerText?.trim() || "";
        const getHref = (sel) =>
          document.querySelector(sel)?.href?.trim() || "";

        const clean = (txt) =>
          txt
            ? txt
                .replace(/[\uE000-\uF8FF]/g, "") // remove Google icon unicode
                .replace(/[]/g, "")
                .replace(/\s+/g, " ")
                .trim()
            : "";

        const name = clean(
          getText("h1.DUwDvf") ||
            getText("div.qBF1Pd") ||
            getText("div.fontHeadlineSmall")
        );
        const phone = clean(
          getText("button[aria-label*='Phone']") ||
            getText("a[href^='tel:']") ||
            getText('[data-item-id^="phone:tel:"]')
        );
        const address = clean(
          getText("button[aria-label*='Address']") ||
            getText('[data-item-id="address"]') ||
            getText("div.W4Efsd span[aria-label*='Address']")
        );
        const website =
          getHref("a[data-item-id^='authority']") ||
          getHref("a[aria-label*='Website']") ||
          getHref("a[href*='https://']");

        return { name, phone, address, website: website || "N/A" };
      });

      if (!data.phone || data.phone.trim() === "") {
        skipped++;
        console.log(`Skipped (no phone): ${data.name || "Unknown"}`);
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

      console.log(`Saved: ${data.name} | ${data.phone}`);
      await page.keyboard.press("Escape");
      await delay(1200);
    } catch (err) {
      console.log(`Error scraping place ${i + 1}: ${err.message}`);
    }
  }

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
  const fileName = `maps_${keyword}_${
    new Date().toISOString().split("T")[0]
  }.csv`;
  const filePath = path.join(TMP_DIR, fileName);

  fs.writeFileSync(filePath, csv, "utf8");

  console.log("\n Summary:");
  console.log(`Total found: ${prevCount}`);
  console.log(`Saved (with phone): ${results.length}`);
  console.log(`Skipped (no phone): ${skipped}`);
  console.log(`File saved: ${filePath}`);
  console.log("Scraping completed successfully.\n");

  await browser.close();
  return filePath;
}

// Entry point
if (process.argv[2]) {
  const url = process.argv[2];
  scrapeGoogleMaps(url).catch((err) =>
    console.error("Fatal error:", err.message)
  );
} else {
  console.error(" No URL provided.");
}
