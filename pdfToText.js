const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const pdfParse = require("pdf-parse");

axiosRetry(axios, { retries: 3, retryDelay: () => 3000 });

async function fetchPdfText(pdfUrl) {
  try {
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
      timeout: 35000,
    });

    const data = await pdfParse(response.data);
    //console.log(data);
    return data.text.trim();
  } catch (err) {
    console.error(`PDF Parser: Failed to process ${pdfUrl}:`, err.message);
    return null;
  }
}

module.exports = { fetchPdfText };
