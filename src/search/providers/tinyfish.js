// src/search/providers/tinyfish.js
export async function searchWithTinyFish(query, apiKey) {
  const response = await fetch("https://api.tinyfish.ai/v1/search", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return await response.json();
}
