export async function enrichWithProspeo(email, apiKey) {
  const response = await fetch("https://api.prospeo.io/v2/enrich", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  return await response.json();
}
