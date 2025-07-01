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
  await page.waitForSelector(".field-pub_date", { timeout: 30000 });

  const today = "1 July 2025";
  console.log("Today (IST):", today);

  const data = await page.evaluate((today) => {
    const rows = Array.from(document.querySelectorAll("#result_list tbody tr"));

    return rows
      .map((row) => {
        const company = row.querySelector("th")?.innerText.trim();
        const date = row.querySelector("td.field-pub_date")?.innerText.trim();
        const pdfUrl =
          Array.from(row.querySelectorAll("td.field-action_display a"))
            .map((a) => a.href)
            .find((href) => href.endsWith(".pdf")) || null;

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
