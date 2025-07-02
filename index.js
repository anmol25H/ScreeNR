const puppeteer = require("puppeteer");
const { getTodayConcallLinks } = require("./scraper.js");
const { fetchPdfText } = require("./pdfToText.js");
const { summarizeConcall } = require("./summarizer.js");
const axios = require("axios");

async function sendToWordPress(summary) {
  try {
    const res = await axios.post(
      "https://profitbooking.in/wp-json/scraper/v1/screener",
      summary
    );
    console.log("Saved to WordPress:", res.data);
  } catch (err) {
    console.error("Failed to save to WordPress:", err.message);
  }
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const concalls = await getTodayConcallLinks();
  console.log(`Found ${concalls.length} concalls for today.\n`);

  for (const { company, date, pdfUrl } of concalls) {
    console.log(`Processing: ${company}`);

    const pdfText = await fetchPdfText(pdfUrl, browser); // ✅ browser passed
    if (!pdfText) {
      console.warn(`Skipped due to unreadable content: ${pdfUrl}`);
      continue;
    }

    const summary = await summarizeConcall(company, pdfText);
    if (!summary) {
      console.log("GROQ summarization failed.\n");
      continue;
    }

    await sendToWordPress(summary);
    console.log(`Summary for ${company}:`);
    console.log(summary);
    console.log("\n---\n");
  }

  await browser.close();
})();
