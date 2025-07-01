const puppeteer = require("puppeteer");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);
require("dotenv").config();

async function getTodayConcallLinks() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
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

  const today = dayjs().tz("Asia/Kolkata").format("D MMMM YYYY");

  const data = await page.evaluate((today) => {
    const rows = Array.from(document.querySelectorAll("#result_list tbody tr"));
    return rows
      .map((row) => {
        const date = row.querySelector(".field-pub_date")?.innerText.trim();
        if (date !== today) return null;

        const company =
          row.querySelector(".ink-900")?.textContent.trim() || "Unknown";
        const pdfLink =
          Array.from(row.querySelectorAll("td a"))
            .map((a) => a.href)
            .find((href) => href.endsWith(".pdf")) || null;

        return { company, date, pdfUrl: pdfLink };
      })
      .filter(Boolean);
  }, today);

  await browser.close();
  return data;
}

module.exports = { getTodayConcallLinks };
