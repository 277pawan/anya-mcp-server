let exaUsage = { daily: 0, date: new Date().toDateString() };

export async function searchWithExa(query, apiKey = null, options = {}) {
  // Works with OR without API key
  const url = apiKey
    ? `https://mcp.exa.ai/mcp?exaApiKey=${apiKey}`
    : "https://mcp.exa.ai/mcp";

  // Exa understands meaning, not just keywords
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: query,
      numResults: options.limit || 10,
      type: "auto", // "auto", "neural", or "keyword"
    }),
  });

  return await response.json();
}
