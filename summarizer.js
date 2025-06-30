const axios = require("axios");
const { jsonrepair } = require("jsonrepair");
require("dotenv").config();

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

async function summarizeConcall(company, pdfText) {
  const prompt = `
You are a top-tier equity research analyst with access to a full earnings transcript or presentation.

TASK:
- Extract all financial KPIs (revenue, profit, dates, forward-looking guidance).
- If values for two periods are available, calculate Year-on-Year (YoY) growth % using ((Current - Previous) / Previous) * 100.
- Always think through the data — infer when needed, and estimate if not clearly labeled.
- If any required field (like RevenueGrowthPercent or ProfitGrowthPercent) is not available in the document, return the string "Not mentioned". Do not return null or leave fields empty.
- NEVER return markdown, commentary, or notes — ONLY a valid JSON object.

OUTPUT FORMAT:
{
  "NSEsymbol": "e.g. TCS, RELIANCE (all caps)",
  "RevenueGrowthPercent": "e.g. 12.4%",
  "ProfitGrowthPercent": "e.g. 18.2%",
  "EarningsReportDate": "e.g. 30 Jun 2025",
  "FutureOpportunities": ["...", "...", "...", "...", "..."],
  "RisksAndDegrowth": ["...", "...", "...", "...", "..."]
}

Important:
- Always return **exactly 5** points in both opportunity and risk lists.
- Use generalizations like "market expansion" if specifics are unavailable.
- Derive NSE symbol from company name if not explicitly present.

INPUT DOCUMENT (first 6000 chars):
${pdfText.slice(0, 6000)}
`;

  try {
    const res = await axios.post(
      GROQ_API,
      {
        model: "llama3-70b-8192",
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

    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    const jsonString = content.substring(start, end + 1);

    try {
      const repaired = jsonrepair(jsonString);
      return JSON.parse(repaired);
    } catch (err) {
      console.error("JSON Repair failed:\n", jsonString);
      return null;
    }
  } catch (err) {
    console.error("GROQ Error:", err.message);
    return null;
  }
}

module.exports = { summarizeConcall };
