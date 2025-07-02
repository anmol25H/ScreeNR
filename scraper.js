const puppeteer = require("puppeteer");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);
require("dotenv").config();

async function getTodayConcallLinks() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();

  // Set user agent to avoid bot detection
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  );

  await page.goto("https://www.screener.in/login/", {
    waitUntil: "networkidle2",
  });

  await page.type("#id_username", process.env.GMAIL_USERNAME);
  await page.type("#id_password", process.env.GMAIL_PASS);

  await Promise.all([
    page.click("button[type='submit']"),
    page.waitForNavigation({ waitUntil: "networkidle2" }),
  ]);

  await page.goto("https://www.screener.in/concalls/", {
    waitUntil: "networkidle2",
  });

  // More robust waiting strategy with multiple fallbacks
  try {
    // First try to wait for the main table
    await page.waitForSelector("#result_list", { timeout: 20000 });

    // Then wait for table rows to load
    await page.waitForSelector("#result_list tbody tr", { timeout: 20000 });

    // Finally wait for the specific field, but with a shorter timeout since table is loaded
    await page.waitForSelector(".field-pub_date", { timeout: 15000 });
  } catch (error) {
    console.log("Primary selectors failed, trying alternative approach...");

    // Fallback: wait for any table content and give it extra time
    try {
      await page.waitForSelector("table", { timeout: 10000 });
      await page.waitForTimeout(3000); // Give extra time for dynamic content
    } catch (fallbackError) {
      console.log("All selectors failed, proceeding with page as-is...");
    }
  }

  const today = "1 July 2025";
  console.log("Today (IST):", today);

  const data = await page.evaluate((today) => {
    const rows = Array.from(document.querySelectorAll("#result_list tbody tr"));

    // Debug: log what we actually found
    console.log(`Found ${rows.length} rows in table`);

    return rows
      .map((row) => {
        const company = row.querySelector("th")?.innerText.trim();
        const dateElement =
          row.querySelector("td.field-pub_date") ||
          row.querySelector("td[class*='pub_date']") ||
          row.querySelector("td[class*='date']");
        const date = dateElement?.innerText.trim();

        const pdfUrl =
          Array.from(row.querySelectorAll("td.field-action_display a, td a"))
            .map((a) => a.href)
            .find((href) => href && href.endsWith(".pdf")) || null;

        if (!company || !date || date !== today || !pdfUrl) return null;

        return { company, date, pdfUrl };
      })
      .filter(Boolean);
  }, today);

  console.log(`Found ${data.length} concalls for ${today}`);
  data.forEach(({ company, pdfUrl }) =>
    console.log(`- ${company} → ${pdfUrl}`)
  );

  await browser.close();
  return data;
}

module.exports = { getTodayConcallLinks };
