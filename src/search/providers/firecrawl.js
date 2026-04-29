export async function scrapeWithFirecrawl(url, apiKey) {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: url,
      formats: ["markdown", "html", "links"],
    }),
  });
  return await response.json();
}
