const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const pdfParse = require("pdf-parse");
const stream = require("stream");
const { promisify } = require("util");
const finished = promisify(stream.finished);

axiosRetry(axios, {
  retries: 2,
  retryDelay: () => 3000,
});

async function safePdfParse(buffer, timeout = 20000) {
  return Promise.race([
    pdfParse(buffer),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("pdfParse timeout after 20s")), timeout)
    ),
  ]);
}

async function fetchPdfText(pdfUrl, browser = null) {
  let buffer = null;

  // First try axios
  try {
    const response = await axios.get(pdfUrl, {
      responseType: "stream",
      timeout: 30000,
    });

    const chunks = [];
    response.data.on("data", (chunk) => chunks.push(chunk));
    await finished(response.data);
    buffer = Buffer.concat(chunks);
  } catch (err) {
    console.warn(`Axios fetch/parse failed for ${pdfUrl}:`, err.message);
  }

  // Fallback to Puppeteer if Axios fails and browser is provided
  if (!buffer && browser) {
    try {
      const page = await browser.newPage();
      const response = await page.goto(pdfUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      if (response && response.ok()) {
        buffer = await response.buffer();
      }
      await page.close();
    } catch (err) {
      console.warn(`Puppeteer fallback failed for ${pdfUrl}:`, err.message);
    }
  }

  if (!buffer) {
    console.warn(`No buffer returned from Puppeteer for ${pdfUrl}`);
    return null;
  }

  let data;
  try {
    data = await safePdfParse(buffer);
  } catch (err) {
    console.warn("PDF parse failed:", err.message);
    return null;
  }

  const text = data.text?.trim() || "";

  const isTooShort = text.length < 100;
  const hasGibberish = /\uE000|\uF000|font private use area/i.test(text);
  const suspiciousCharRatio =
    (text.match(/[^\x00-\x7F]/g) || []).length / text.length;

  if (isTooShort || hasGibberish || suspiciousCharRatio > 0.3) {
    console.warn(`Skipping noisy/unusable PDF: ${pdfUrl}`);
    return null;
  }

  return text;
}

module.exports = { fetchPdfText };
