// src/search/providers/leadQualifier.js
// Uses your existing Groq models (free tier!)

const LEAD_QUALIFIER_MODEL = "llama-3.1-8b-instant"; // High RPM, perfect for this

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

Identify relevant leads that match: ${queryContext}

Return ONLY valid JSON matching the specified format.`;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LEAD_QUALIFIER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Groq API Error:", data);
    return { success: false, error: data.error?.message || "Groq API error" };
  }

  let result;
  try {
    result = JSON.parse(data.choices[0].message.content);
  } catch (err) {
    console.error("Failed to parse Groq response:", err);
    return { success: false, error: "Failed to parse JSON from AI response" };
  }

  return {
    success: true,
    ...result,
    qualifiedLeads: result.qualifiedLeads?.slice(0, maxLeadsToReturn) || [],
    timestamp: new Date().toISOString(),
  };
}
