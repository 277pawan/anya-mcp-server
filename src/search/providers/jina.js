export async function scrapeWithJina(url) {
  // Completely free, no key needed for basic usage
  const response = await fetch(`https://r.jina.ai/${url}`);
  const content = await response.text();
  return { success: true, content, provider: "jina" };
}

export async function searchWithJina(query) {
  const response = await fetch(
    `https://s.jina.ai/${encodeURIComponent(query)}`,
  );
  const results = await response.json();
  return results;
}
