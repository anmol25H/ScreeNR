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

  // Wait for login form to be ready
  await page.waitForSelector("#id_username", { timeout: 10000 });
  await page.waitForSelector("#id_password", { timeout: 10000 });

  // Debug: Check if credentials are loaded
  console.log("Username available:", !!process.env.GMAIL_USERNAME);
  console.log("Password available:", !!process.env.GMAIL_PASS);
  console.log("Username length:", process.env.GMAIL_USERNAME?.length || 0);

  // Clear any existing input and type credentials
  await page.click("#id_username", { clickCount: 3 });
  await page.type("#id_username", process.env.GMAIL_USERNAME, { delay: 50 });

  await page.click("#id_password", { clickCount: 3 });
  await page.type("#id_password", process.env.GMAIL_PASS, { delay: 50 });

  // Debug: Check what was actually typed
  const typedUsername = await page.$eval("#id_username", (el) => el.value);
  const typedPasswordLength = await page.$eval(
    "#id_password",
    (el) => el.value.length
  );
  console.log("Typed username:", typedUsername);
  console.log("Typed password length:", typedPasswordLength);

  // Check for any error messages on the page before submitting
  const existingErrors = await page.$eval(
    "body",
    (el) =>
      el.textContent.includes("error") ||
      el.textContent.includes("invalid") ||
      el.textContent.includes("incorrect")
  );
  console.log("Pre-submit errors on page:", existingErrors);

  // Add a small delay before clicking submit
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Try to submit and handle potential issues
  try {
    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
    ]);
  } catch (navError) {
    console.log("Navigation error during login:", navError.message);
    // Wait a bit more in case navigation is slow
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Check if login was successful
  const currentUrl = page.url();
  console.log("URL after login attempt:", currentUrl);

  // Also check for error messages on the page
  const hasErrors = await page.evaluate(() => {
    const errorSelectors = [
      ".error",
      ".alert",
      ".errorlist",
      '[class*="error"]',
      '[class*="invalid"]',
    ];
    return errorSelectors.some((selector) => {
      const elements = document.querySelectorAll(selector);
      return Array.from(elements).some(
        (el) => el.textContent.trim().length > 0
      );
    });
  });

  const pageText = await page.evaluate(() =>
    document.body.textContent.toLowerCase()
  );
  const hasErrorText =
    pageText.includes("invalid") ||
    pageText.includes("incorrect") ||
    pageText.includes("error");

  console.log("Has error elements:", hasErrors);
  console.log("Has error text:", hasErrorText);

  if (
    currentUrl.includes("/register/") ||
    currentUrl.includes("/login/") ||
    hasErrors ||
    hasErrorText
  ) {
    // Get any specific error messages
    const errorMessages = await page.evaluate(() => {
      const errorSelectors = [
        ".error",
        ".alert",
        ".errorlist",
        '[class*="error"]',
      ];
      const messages = [];
      errorSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          if (el.textContent.trim()) messages.push(el.textContent.trim());
        });
      });
      return messages;
    });

    console.log("Error messages found:", errorMessages);
    throw new Error(
      `Login failed - still on login/register page. Error messages: ${
        errorMessages.join(", ") || "None found"
      }`
    );
  }

  await page.goto("https://www.screener.in/concalls/", {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  // Double-check we're on the right page
  const finalUrl = page.url();
  const finalTitle = await page.title();
  console.log("Final URL:", finalUrl);
  console.log("Final title:", finalTitle);

  if (finalUrl.includes("/register/") || finalUrl.includes("/login/")) {
    throw new Error("Unable to access concalls page - authentication required");
  }

  // Debug: Take screenshot and log page content
  console.log("Current URL:", page.url());

  // Wait longer and try multiple strategies
  await new Promise((resolve) => setTimeout(resolve, 5000)); // Give page time to load completely

  // Check if we're actually on the concalls page
  const pageTitle = await page.title();
  console.log("Page title:", pageTitle);

  // More robust waiting strategy with multiple fallbacks
  let tableLoaded = false;
  try {
    // First try to wait for the main table
    await page.waitForSelector("#result_list", { timeout: 20000 });
    console.log("Found #result_list");

    // Then wait for table rows to load
    await page.waitForSelector("#result_list tbody tr", { timeout: 20000 });
    console.log("Found table rows");

    // Finally wait for the specific field, but with a shorter timeout since table is loaded
    await page.waitForSelector(".field-pub_date", { timeout: 15000 });
    console.log("Found .field-pub_date");
    tableLoaded = true;
  } catch (error) {
    console.log("Primary selectors failed, trying alternative approach...");
    console.log("Error:", error.message);

    // Fallback: wait for any table content and give it extra time
    try {
      await page.waitForSelector("table", { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Give extra time for dynamic content
      console.log("Found fallback table");
    } catch (fallbackError) {
      console.log("All selectors failed, proceeding with page as-is...");
      console.log("Fallback error:", fallbackError.message);
    }
  }

  // Debug: Log what's actually on the page
  const pageContent = await page.evaluate(() => {
    const resultList = document.querySelector("#result_list");
    const tables = document.querySelectorAll("table");
    const rows = document.querySelectorAll("tr");

    return {
      hasResultList: !!resultList,
      tableCount: tables.length,
      rowCount: rows.length,
      bodyHTML: document.body.innerHTML.substring(0, 1000), // First 1000 chars
    };
  });

  console.log("Page debug info:", JSON.stringify(pageContent, null, 2));

  const today = dayjs().tz("Asia/Kolkata").format("D MMMM YYYY");

  console.log("Today (IST):", today);

  const data = await page.evaluate((today) => {
    // Debug: log what we actually found
    const resultList = document.querySelector("#result_list");
    const allRows = document.querySelectorAll("tr");
    const tableRows = document.querySelectorAll("#result_list tbody tr");
    const alternativeRows = document.querySelectorAll(
      "table tbody tr, table tr"
    );

    console.log(`Debug info:
      - Has #result_list: ${!!resultList}
      - Total rows on page: ${allRows.length}
      - #result_list tbody tr: ${tableRows.length}
      - Alternative table rows: ${alternativeRows.length}
    `);

    // Try multiple row selection strategies
    let rows = Array.from(tableRows);
    if (rows.length === 0) {
      console.log("No rows in #result_list, trying alternative selectors...");
      rows = Array.from(alternativeRows);
    }

    console.log(`Using ${rows.length} rows for processing`);

    // Debug: log first few rows content
    rows.slice(0, 3).forEach((row, index) => {
      console.log(`Row ${index} HTML:`, row.innerHTML.substring(0, 200));
    });

    return rows
      .map((row, index) => {
        const company =
          row.querySelector("th")?.innerText.trim() ||
          row.querySelector("td:first-child")?.innerText.trim();

        // Try multiple date selectors
        const dateElement =
          row.querySelector("td.field-pub_date") ||
          row.querySelector("td[class*='pub_date']") ||
          row.querySelector("td[class*='date']") ||
          row.querySelector("td:nth-child(2)"); // Common position for date
        const date = dateElement?.innerText.trim();

        // Try multiple PDF link selectors
        const pdfUrl =
          Array.from(row.querySelectorAll("a"))
            .map((a) => a.href)
            .find((href) => href && href.endsWith(".pdf")) || null;

        console.log(
          `Row ${index}: Company="${company}", Date="${date}", PDF="${pdfUrl}"`
        );

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
