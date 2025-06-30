const axios = require("axios");
require("dotenv").config();

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

async function summarizeConcall(company, pdfText) {
  const prompt = `
You're a financial AI assistant.

Read this earnings call transcript and return **only this JSON**, nothing else (no introductions, no markdown, no extra lines):

{
  "NSEsymbol": "string or null",
  "RevenueGrowthPercent": "string",
  "ProfitGrowthPercent": "string",
  "EarningsReportDate": "string",
  "FutureOpportunities": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "RisksAndDegrowth": ["point 1", "point 2", "point 3", "point 4", "point 5"]
}

Be concise but informative. Always provide 5 bullet points, even if you need to generalize.

Transcript:
${pdfText.slice(0, 4000)}
`;

  try {
    const res = await axios.post(
      GROQ_API,
      {
        model: "llama3-8b-8192",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const content = res.data.choices[0]?.message?.content || "";

    try {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      const jsonString = content.substring(start, end + 1);
      return JSON.parse(jsonString);
    } catch (err) {
      console.error("GROQ returned wrong JSON:\n", content);
      return null;
    }
  } catch (err) {
    console.error("GROQ Error:", err.message);
    return null;
  }
}

module.exports = { summarizeConcall };
