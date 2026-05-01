// src/search/leadPipeline.js
import { searchWeb, scrapeUrl } from "./master.js";
import { qualifyLeads } from "./providers/leadQualifier.js";
import { enrichBatchLeads } from "./providers/prospeo.js";
import { findEmailWithHunter } from "./providers/hunter.js";
import { generateProposal } from "./providers/proposalGenerator.js";

export async function findLeadsForProposal(targetQuery, options = {}) {
  const {
    searchType = "semantic",
    maxLeads = 10,
    minScore = 70,
    includeContactInfo = true,
    generateTemplates = false, // Automatically create email templates
    objective = "freelance_pitch",
    userContext = {
      name: "Your Name",
      role: "Developer",
      pitch: "I build amazing experiences.",
    },
  } = options;

  console.log(`🔍 Searching for: ${targetQuery}`);

  // Step 1: Search for relevant content
  const searchResults = await searchWeb(targetQuery, searchType, { limit: 20 });

  if (!searchResults.success || !searchResults.results?.length) {
    return { success: false, error: "No search results found" };
  }

  console.log(`📄 Found ${searchResults.results.length} potential sources`);

  // Step 2: Scrape the top results (with strict timeout to prevent hanging)
  const scrapedData = [];

  // Helper for timeout
  const withTimeout = (promise, ms) => {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
      ),
    ]);
  };

  for (let i = 0; i < Math.min(searchResults.results.length, 10); i++) {
    const result = searchResults.results[i];
    try {
      console.log(
        `   [${i + 1}/10] 🌐 Scraping: ${result.url.substring(0, 50)}...`,
      );
      // Force 8 second timeout per scrape
      const scraped = await withTimeout(scrapeUrl(result.url), 8000);

      if (scraped && scraped.success) {
        scrapedData.push({
          url: result.url,
          title: result.title,
          content: scraped.markdown || scraped.content,
          snippet: result.description || "No description available",
        });
      }
    } catch (error) {
      console.log(
        `   ❌ Failed to scrape ${result.url.substring(0, 30)}: ${error.message}`,
      );
    }

    // Small delay to be polite
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // Step 3: AI qualification
  console.log(`🤖 AI qualifying ${scrapedData.length} sources...`);
  const qualified = await qualifyLeads(
    scrapedData,
    targetQuery,
    process.env.GROQ_API_KEY,
    { minRelevanceScore: minScore, maxLeadsToReturn: maxLeads * 2 },
  );

  if (!qualified.qualifiedLeads?.length) {
    console.log(
      `⚠️ AI found no qualified leads out of ${scrapedData.length} scraped sources.`,
    );
    return {
      success: false,
      error:
        "No qualified leads found. Sources might not be actual job postings.",
    };
  }

  console.log(`✅ Found ${qualified.qualifiedLeads.length} qualified leads`);

  // Step 4: Enrich with contact info
  let leads = qualified.qualifiedLeads;

  if (includeContactInfo) {
    console.log(`📧 Finding contact information...`);

    // Try to find emails using multiple methods
    for (const lead of leads) {
      // Try Hunter first
      if (lead.company && process.env.HUNTER_API_KEY) {
        const hunterResult = await findEmailWithHunter(
          lead.company,
          lead.name,
          process.env.HUNTER_API_KEY,
        );

        if (hunterResult.success && hunterResult.emails?.length) {
          lead.foundEmails = hunterResult.emails;
          lead.emailSource = "hunter";
        }
      }

      // Try Exa as backup
      if (!lead.foundEmails?.length && process.env.EXA_API_KEY) {
        const exaQuery = `${lead.name} ${lead.company} email address`;
        const exaResult = await searchWeb(exaQuery, "semantic", { limit: 3 });
        if (exaResult.success) {
          lead.foundEmails = extractEmailsFromResults(exaResult.results);
          lead.emailSource = "exa";
        }
      }
    }

    // Optional: Prospeo enrichment for high-value leads
    if (process.env.PROSPEO_API_KEY) {
      const highValueLeads = leads.filter((l) => l.relevanceScore > 85);
      const enriched = await enrichBatchLeads(
        highValueLeads,
        process.env.PROSPEO_API_KEY,
      );

      // Merge enriched data
      for (const enrichedLead of enriched) {
        const index = leads.findIndex((l) => l.name === enrichedLead.name);
        if (index !== -1) {
          leads[index] = { ...leads[index], ...enrichedLead };
        }
      }
    }
  }

  // Step 4.5: Generate proposals for top leads if requested
  if (generateTemplates) {
    console.log(`✍️ Generating personalized email templates...`);
    for (const lead of leads) {
      const proposalData = await generateProposal(lead, userContext, objective);
      if (proposalData.success) {
        lead.proposal = {
          subject: proposalData.subject,
          body: proposalData.body,
        };
      }
    }
  }

  // Step 5: Generate proposal-ready output
  const finalLeads = leads.slice(0, maxLeads).map((lead) => ({
    name: lead.name,
    title: lead.title,
    company: lead.company,
    relevanceScore: lead.relevanceScore,
    reasoning: lead.reasoning,
    email: lead.foundEmails?.[0] || lead.possibleEmails?.[0] || null,
    phone: lead.phoneNumber || null,
    linkedin: lead.linkedin || null,
    sourceUrl: lead.sourceUrl,
    proposalReady: !!(lead.foundEmails?.[0] || lead.possibleEmails?.[0]),
    proposal: lead.proposal || null,
  }));

  return {
    success: true,
    query: targetQuery,
    totalSourcesAnalyzed: scrapedData.length,
    totalLeadsFound: qualified.qualifiedLeads.length,
    leads: finalLeads,
    summary: qualified.summary,
    generatedAt: new Date().toISOString(),
  };
}

function extractEmailsFromResults(results) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = [];

  for (const result of results) {
    const content = `${result.title || ""} ${result.content || ""} ${result.description || ""}`;
    const found = content.match(emailRegex) || [];
    emails.push(...found);
  }

  return [...new Set(emails)];
}
