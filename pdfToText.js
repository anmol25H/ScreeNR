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
    return; // Ignore this known spam
  }
  originalConsoleWarn(msg, ...args); // Allow all other warnings
};

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
//Some of the pdf are scanned copies or some may have images in it which becomes hard to convert

async function fetchPdfText(pdfUrl) {
  try {
    const response = await axios.get(pdfUrl, {
      responseType: "stream",
      timeout: 30000,
    });

    const chunks = [];
    response.data.on("data", (chunk) => chunks.push(chunk));
    await finished(response.data);

    const buffer = Buffer.concat(chunks);
    let data;
    try {
      data = await safePdfParse(buffer);
    } catch (err) {
      console.warn("PDF parse failed (timeout or error):", err.message);
      return null;
    }

    const text = data.text?.trim() || "";

    const isTooShort = text.length < 100;
    const hasGibberish = /\uE000|\uF000|font private use area/i.test(text);
    const suspiciousCharRatio =
      (text.match(/[^\x00-\x7F]/g) || []).length / text.length;

    if (isTooShort || hasGibberish || suspiciousCharRatio > 0.3) {
      console.warn(`⏭️ Skipping noisy/unusable PDF: ${pdfUrl}`);
      return null;
    }

    return text;
  } catch (err) {
    console.error(`fetchPdfText failed for ${pdfUrl}:`, err.message);
    return null;
  }
}

module.exports = { fetchPdfText };
