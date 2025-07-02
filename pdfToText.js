const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const pdfParse = require("pdf-parse");
const stream = require("stream");
const { promisify } = require("util");
const finished = promisify(stream.finished);

const originalConsoleWarn = console.warn;
console.warn = function (msg, ...args) {
  if (
    typeof msg === "string" &&
    msg.includes("Ran out of space in font private use area")
  ) {
    return;
  }
  originalConsoleWarn(msg, ...args);
};

axiosRetry(axios, {
  retries: 2,
  retryDelay: () => 3000,
});

// Utility to check if PDF is gibberish or too short
function isInvalidText(text) {
  const isTooShort = text.length < 100;
  const hasGibberish = /\uE000|\uF000|font private use area/i.test(text);
  const suspiciousCharRatio =
    (text.match(/[^\x00-\x7F]/g) || []).length / text.length;
  return isTooShort || hasGibberish || suspiciousCharRatio > 0.3;
}

async function safePdfParse(buffer, timeout = 30000) {
  return Promise.race([
    pdfParse(buffer),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("pdfParse timeout after 30s")), timeout)
    ),
  ]);
}

async function fetchPdfViaAxios(pdfUrl) {
  const response = await axios.get(pdfUrl, {
    responseType: "stream",
    timeout: 60000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Referer: "https://www.screener.in/",
      Accept: "application/pdf",
    },
  });

  const chunks = [];
  response.data.on("data", (chunk) => chunks.push(chunk));
  await finished(response.data);
  return Buffer.concat(chunks);
}

async function fetchPdfViaPuppeteer(browser, url) {
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Extract the embedded PDF src from <embed> or <iframe>
    const pdfFrameSrc = await page.evaluate(() => {
      const embed = document.querySelector("embed[type='application/pdf']");
      const iframe = document.querySelector("iframe");
      return embed?.src || iframe?.src || null;
    });

    if (!pdfFrameSrc) {
      throw new Error("No embedded PDF source found");
    }

    console.log("📄 Found embedded PDF:", pdfFrameSrc);

    // Download actual PDF using Axios
    const response = await axios.get(pdfFrameSrc, {
      responseType: "arraybuffer",
      headers: {
        Referer: url,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "application/pdf",
      },
    });

    return Buffer.from(response.data);
  } catch (err) {
    console.warn("Puppeteer PDF fallback failed:", err.message);
    return null;
  }
}

async function fetchPdfText(pdfUrl, browser = null) {
  let buffer;

  // Step 1: Try Axios
  try {
    buffer = await fetchPdfViaAxios(pdfUrl);
    const data = await safePdfParse(buffer);
    const text = data.text?.trim() || "";

    if (!isInvalidText(text)) return text;
    console.warn(`⏭️ Skipping noisy/unusable PDF via Axios: ${pdfUrl}`);
  } catch (err) {
    console.warn(`Axios fetch/parse failed for ${pdfUrl}:`, err.message);
  }

  // Step 2: Fallback to Puppeteer (if browser is passed)
  if (browser) {
    try {
      buffer = await fetchPdfViaPuppeteer(browser, pdfUrl);
      if (!buffer) throw new Error("No buffer returned from Puppeteer");

      const data = await safePdfParse(buffer);
      const text = data.text?.trim() || "";

      if (!isInvalidText(text)) return text;
      console.warn(`Skipping noisy/unusable PDF via Puppeteer: ${pdfUrl}`);
    } catch (err) {
      console.warn(`Puppeteer fallback failed for ${pdfUrl}:`, err.message);
    }
  }

  return null;
}

module.exports = { fetchPdfText };
