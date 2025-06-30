const axios = require("axios");
const pdfParse = require("pdf-parse");

async function fetchPdfText(pdfUrl) {
  try {
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
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
