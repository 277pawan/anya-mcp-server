import { CONFIG } from "../../config/config.js";
import { chatWithGlobalFallback } from "../../ai/llm-fallback.js";

// src/search/providers/leadQualifier.js
const LEAD_QUALIFIER_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
];

export async function qualifyLeads(
  scrapedData,
  queryContext,
  apiKey,
  options = {},
) {
  const {
    minRelevanceScore = 70,
    maxLeadsToReturn = 20,
    includeReasoning = true,
  } = options;

  const systemPrompt = `You are an expert lead qualification AI. Your job is to analyze scraped data and identify individuals or companies that are MOST likely to be interested in the given service/opportunity.

Rules:
1. Return ONLY valid JSON - no explanations outside JSON
2. Score each lead 0-100 based on relevance
3. Filter out anything below ${minRelevanceScore}
4. Extract key information: name, title, company, possible email patterns, social profiles
5. Provide reasoning for high-quality leads (score > 80)
6. Reject or score very low: generic job-board homepages, category hubs (e.g. "Jobs on LinkedIn", "Fiverr categories", ZipRecruiter sitemaps) unless the snippet shows one concrete role and employer
7. Prefer a specific hiring company or contact over the marketplace brand (not "LinkedIn" / "Indeed" as company unless it is truly LinkedIn corporate hiring)
8. For LinkedIn, favor individual job posts or clear hiring signals over navigational pages

Output format:
{
  "qualifiedLeads": [
    {
      "name": "John Doe",
      "title": "CTO",
      "company": "Tech Corp",
      "relevanceScore": 95,
      "reasoning": "Explicitly looking for MERN dev",
      "possibleEmails": ["john@techcorp.com", "j.doe@techcorp.com"],
      "sourceUrl": "https://...",
      "keySignals": ["hiring", "looking for", "need a developer"]
    }
  ],
  "summary": {
    "totalFound": 10,
    "qualified": 6,
    "avgScore": 82
  }
}`;

  // Truncate to avoid context window limit
  const truncatedData = scrapedData.map(d => ({
    url: d.url,
    title: d.title,
    snippet: d.snippet ? d.snippet.substring(0, 500) : "",
    content: d.content ? d.content.substring(0, 1000) : "",
  }));

  const userPrompt = `
Query Context: ${queryContext}

Scraped Data (Truncated for context limit):
${JSON.stringify(truncatedData, null, 2)}

Identify employers or contacts actively hiring or buying services for this query. Skip platform landing pages and pure directories.

Return ONLY valid JSON matching the specified format.`;

  if (!apiKey && !process.env.MISTRAL_API_KEY && !CONFIG.MISTRAL_API_KEY) {
    return { success: false, error: "Missing GROQ_API_KEY and MISTRAL_API_KEY" };
  }

  let result;
  const response = await chatWithGlobalFallback({
    taskName: "Lead qualification",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    maxTokens: 700,
    responseFormat: { type: "json_object" },
    groqModels: LEAD_QUALIFIER_MODELS,
    mistralModels: ["mistral-small-latest"],
    groqApiKey: apiKey || process.env.GROQ_API_KEY || CONFIG.GROQ_API_KEY,
    mistralApiKey: process.env.MISTRAL_API_KEY || CONFIG.MISTRAL_API_KEY,
  });

  if (!response.success) {
    console.error("Lead Qualifier API Error:", response.error);
    return { success: false, error: response.error || "AI provider error" };
  }

  try {
    result = JSON.parse(response.content);
  } catch (err) {
    console.error("Failed to parse AI response:", err);
    return { success: false, error: "Failed to parse JSON from AI response" };
  }

  return {
    success: true,
    ...result,
    qualifiedLeads: result.qualifiedLeads?.slice(0, maxLeadsToReturn) || [],
    timestamp: new Date().toISOString(),
  };
}
