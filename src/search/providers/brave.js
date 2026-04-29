let braveMonthly = 0;
let currentMonth = new Date().getMonth();

export async function searchWithBrave(query, apiKey) {
  // Brave's $5 free credit = ~1000 searches/month
  if (braveMonthly >= 1000) {
    throw new Error("Monthly free limit reached. Wait for next month.");
  }

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
    { headers: { "X-Subscription-Token": apiKey } },
  );

  braveMonthly++;
  return await response.json();
}
