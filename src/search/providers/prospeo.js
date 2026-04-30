// src/search/providers/prospeo.js
export async function enrichWithProspeo(email, apiKey) {
  try {
    const response = await fetch("https://api.prospeo.io/v2/enrich", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      if (response.status === 402) {
        console.warn("Prospeo credits exhausted");
        return null;
      }
      throw new Error(`Prospeo error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Prospeo enrichment failed:", error.message);
    return null;
  }
}

// Batch enrichment with rate limiting
export async function enrichBatchLeads(leads, apiKey, concurrency = 3) {
  const results = [];
  const batchSize = concurrency;

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (lead) => {
        if (!lead.possibleEmails?.[0]) return { ...lead, enriched: false };

        const enriched = await enrichWithProspeo(
          lead.possibleEmails[0],
          apiKey,
        );
        return {
          ...lead,
          enriched: enriched || null,
          verified: enriched?.status === "valid",
          phoneNumber: enriched?.phone,
          linkedin: enriched?.linkedin_url,
        };
      }),
    );

    results.push(...batchResults);

    // Rate limiting delay
    if (i + batchSize < leads.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}
