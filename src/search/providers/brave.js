let braveMonthly = 0;
let currentMonth = new Date().getMonth();

export async function searchWithBrave(query, apiKey, options = {}) {
  // Brave's $5 free credit = ~1000 searches/month
  if (braveMonthly >= 1000) {
    throw new Error("Monthly free limit reached. Wait for next month.");
  }

  const raw = Number(options.limit ?? options.count);
  const count = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 20) : 10;
  
  let searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  if (options.recent !== false) {
    searchUrl += `&freshness=pm`; // past month
  }

  const response = await fetch(searchUrl, { headers: { "X-Subscription-Token": apiKey } });

  braveMonthly++;
  return await response.json();
}
