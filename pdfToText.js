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
  retries: 3,
  retryDelay: (retryCount) => retryCount * 2000, // Progressive delay
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkError(error) ||
      axiosRetry.isRetryableError(error) ||
      (error.response && [403, 429, 503].includes(error.response.status))
    );
  },
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

// Enhanced headers to mimic real browser behavior
function getBSEHeaders(referer = "https://www.bseindia.com/") {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    Referer: referer,
    Origin: "https://www.bseindia.com",
  };
}

async function fetchPdfViaAxios(pdfUrl) {
  // Create a session with proper cookie handling
  const axiosInstance = axios.create({
    timeout: 60000,
    maxRedirects: 5,
    withCredentials: true,
    validateStatus: (status) => status < 500, // Don't throw on 4xx errors
  });

  try {
    // Step 1: Visit BSE main page to establish session
    console.log("Establishing BSE session...");
    await axiosInstance.get("https://www.bseindia.com/", {
      headers: getBSEHeaders(),
    });

    // Small delay to mimic human behavior
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Step 2: Fetch the PDF with session cookies
    console.log("Fetching PDF with session...");
    const response = await axiosInstance.get(pdfUrl, {
      responseType: "stream",
      headers: getBSEHeaders("https://www.bseindia.com/corporates/ann.html"),
    });

    if (response.status === 403) {
      throw new Error(`Access denied (403) - BSE blocking request`);
    }

    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const chunks = [];
    response.data.on("data", (chunk) => chunks.push(chunk));
    await finished(response.data);
    return Buffer.concat(chunks);
  } catch (error) {
    if (error.response?.status === 403) {
      throw new Error(`BSE Access Denied: Session/authentication required`);
    }
    throw error;
  }
}

async function fetchPdfViaPuppeteer(browser, url) {
  const page = await browser.newPage();

  try {
    // Set comprehensive browser fingerprinting
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Set viewport to look more human
    await page.setViewport({ width: 1366, height: 768 });

    // Enable request interception to modify headers
    await page.setRequestInterception(true);

    page.on("request", (req) => {
      const headers = {
        ...req.headers(),
        Accept:
          "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://www.bseindia.com/",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
      };

      req.continue({ headers });
    });

    console.log("Puppeteer: Visiting BSE main page first...");
    // First visit BSE main page to establish session
    await page.goto("https://www.bseindia.com/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait a bit to establish session
    await page.waitForTimeout(2000);

    console.log("Puppeteer: Now fetching PDF...");

    // Method 1: Try direct navigation to PDF
    try {
      const response = await page.goto(url, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      if (
        response &&
        response.headers()["content-type"]?.includes("application/pdf")
      ) {
        const buffer = await response.buffer();
        if (buffer && buffer.length > 0) {
          console.log(
            `PDF downloaded via direct navigation: ${buffer.length} bytes`
          );
          return buffer;
        }
      }
    } catch (directError) {
      console.log("Direct navigation failed, trying CDP method...");
    }

    // Method 2: CDP Session approach (your original method)
    const client = await page.target().createCDPSession();
    await client.send("Network.enable");

    let pdfBuffer = null;
    const bufferPromise = new Promise((resolve) => {
      client.on("Network.responseReceived", async (event) => {
        const { response, requestId } = event;
        if (
          (response.url.includes("AnnPdfOpen.aspx") || response.url === url) &&
          (response.mimeType === "application/pdf" ||
            response.headers["content-type"]?.includes("pdf"))
        ) {
          try {
            const result = await client.send("Network.getResponseBody", {
              requestId,
            });
            pdfBuffer = Buffer.from(
              result.body,
              result.base64Encoded ? "base64" : "utf8"
            );
            console.log(`PDF captured via CDP: ${pdfBuffer.length} bytes`);
            resolve(pdfBuffer);
          } catch (cdpError) {
            console.warn("CDP getResponseBody failed:", cdpError.message);
            resolve(null);
          }
        }
      });
    });

    // Navigate and wait for potential PDF response
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for either buffer or timeout
    await Promise.race([
      bufferPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
    ]);

    return pdfBuffer;
  } catch (err) {
    console.warn("Puppeteer PDF fetch failed:", err.message);
    return null;
  } finally {
    await page.close();
  }
}

async function fetchPdfText(pdfUrl, browser = null) {
  console.log(`\nProcessing PDF: ${pdfUrl}`);
  let buffer;

  // Step 1: Try enhanced Axios approach
  try {
    console.log("📡 Attempting Axios with BSE session...");
    buffer = await fetchPdfViaAxios(pdfUrl);

    if (buffer && buffer.length > 0) {
      console.log(`Buffer received: ${buffer.length} bytes`);
      const data = await safePdfParse(buffer);
      const text = data.text?.trim() || "";

      if (!isInvalidText(text)) {
        console.log(`Valid text extracted: ${text.length} characters`);
        return text;
      }
      console.warn(`Text appears invalid/noisy`);
    }
  } catch (err) {
    console.warn(`Axios method failed:`, err.message);
  }

  // Step 2: Enhanced Puppeteer fallback
  if (browser) {
    try {
      console.log("Attempting Puppeteer fallback...");
      buffer = await fetchPdfViaPuppeteer(browser, pdfUrl);

      if (buffer && buffer.length > 0) {
        console.log(`Puppeteer buffer: ${buffer.length} bytes`);
        const data = await safePdfParse(buffer);
        const text = data.text?.trim() || "";

        if (!isInvalidText(text)) {
          console.log(`Valid text from Puppeteer: ${text.length} characters`);
          return text;
        }
        console.warn(`Puppeteer text appears invalid/noisy`);
      }
    } catch (err) {
      console.warn(`Puppeteer fallback failed:`, err.message);
    }
  }

  console.error(`All methods failed for: ${pdfUrl}`);
  return null;
}

module.exports = { fetchPdfText };
