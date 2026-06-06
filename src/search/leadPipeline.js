// src/search/leadPipeline.js
import { searchWeb, scrapeUrl } from "./master.js";
import { qualifyLeads } from "./providers/leadQualifier.js";
import { enrichBatchLeads } from "./providers/prospeo.js";
import { findEmailWithHunter } from "./providers/hunter.js";
import { generateProposal } from "./providers/proposalGenerator.js";
import { logBackgroundProgress } from "../services/background-logger.service.js";
import {
  DEFAULT_LEAD_FETCH_LIMIT,
  DEFAULT_MAX_LEADS,
} from "./leadPipelineDefaults.js";

export { DEFAULT_LEAD_FETCH_LIMIT, DEFAULT_MAX_LEADS } from "./leadPipelineDefaults.js";

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function mergePrioritizeLinkedIn(linkedinResults, generalResults) {
  const seen = new Set();
  const out = [];
  for (const r of linkedinResults || []) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  for (const r of generalResults || []) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

export async function findLeadsForProposal(targetQuery, options = {}) {
  const {
    sessionId = null,
    userId = null,
    searchType = "semantic",
    maxLeads = DEFAULT_MAX_LEADS,
    minScore = 70,
    includeContactInfo = true,
    generateTemplates = false,
    objective = "freelance_pitch",
    fetchLimit: fetchLimitOption,
    scrapeTimeoutMs = positiveInt(process.env.LEAD_SCRAPE_TIMEOUT_MS, 25000),
    linkedInBoost: linkedInBoostOption,
    userContext = {
      name: "Your Name",
      role: "Developer",
      pitch: "I build amazing experiences.",
    },
  } = options;

  const settings = userContext.pipelineSettings || {};
  const effectiveFetchLimit = positiveInt(
    fetchLimitOption ?? settings.fetchLimit,
    DEFAULT_LEAD_FETCH_LIMIT,
  );
  const effectiveScrapeTimeout = positiveInt(scrapeTimeoutMs, 25000);
  const linkedInBoost =
    linkedInBoostOption ??
    (process.env.LEAD_LINKEDIN_BOOST !== "0" &&
      (objective === "job_hunting" || objective === "freelance_pitch"));

  await logBackgroundProgress(userId, sessionId, "job_search", `Initiating job search: "${targetQuery}"...`);

  console.log(
    `🔍 Searching for: ${targetQuery} (URLs to fetch & scrape: ${effectiveFetchLimit})`,
  );

  await logBackgroundProgress(userId, sessionId, "job_search", "Crawling web search results...");
  const searchResults = await searchWeb(targetQuery, searchType, {
    limit: effectiveFetchLimit,
  });

  if (!searchResults.success || !searchResults.results?.length) {
    await logBackgroundProgress(userId, sessionId, "job_search", "Crawling web search results complete: No listings found.");
    return { success: false, error: "No search results found" };
  }

  let resultsToScrape = searchResults.results;

  if (linkedInBoost) {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toLocaleString('default', { month: 'long' });
    const liQuery = `(site:linkedin.com/jobs OR site:linkedin.com/posts) ${targetQuery} "hiring" OR "looking for" "${currentMonth} ${currentYear}"`;
    const liSearch = await searchWeb(liQuery, searchType, {
      limit: effectiveFetchLimit,
    });
    if (liSearch.success && liSearch.results?.length) {
      resultsToScrape = mergePrioritizeLinkedIn(
        liSearch.results,
        searchResults.results,
      );
      console.log(
        `📌 LinkedIn jobs boost: ${liSearch.results.length} job-SERP hits merged → ${resultsToScrape.length} unique URLs (LinkedIn first)`,
      );
    }
  }

  const totalFromSearch = resultsToScrape.length;
  console.log(`📄 Found ${totalFromSearch} potential sources to consider`);
  await logBackgroundProgress(userId, sessionId, "job_search", `Crawled search listings: Found ${totalFromSearch} potential job post URLs.`);

  if (totalFromSearch > effectiveFetchLimit) {
    console.log(
      `📎 Scraping first ${effectiveFetchLimit} of ${totalFromSearch} merged URLs (raise fetchLimit in settings / options for more)`,
    );
  }

  const scrapedData = [];

  const withTimeout = (promise, ms) => {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
      ),
    ]);
  };

  const scrapeCap = Math.min(resultsToScrape.length, effectiveFetchLimit);
  await logBackgroundProgress(userId, sessionId, "job_search", `Scraping and analyzing content from ${scrapeCap} source(s)...`);
  for (let i = 0; i < scrapeCap; i++) {
    const result = resultsToScrape[i];
    try {
      console.log(
        `   [${i + 1}/${scrapeCap}] 🌐 Scraping: ${result.url.substring(0, 50)}...`,
      );
      const scraped = await withTimeout(
        scrapeUrl(result.url),
        effectiveScrapeTimeout,
      );

      if (scraped && scraped.success) {
        const contentStr = scraped.markdown || scraped.content;
        
        if (contentStr && /no longer accepting( applications)?/i.test(contentStr)) {
          console.log(`   ⏭️ Skipping ${result.url.substring(0, 30)} (no longer accepting applications)`);
          continue;
        }

        scrapedData.push({
          url: result.url,
          title: result.title,
          content: contentStr,
          snippet: result.description || "No description available",
        });
      }
    } catch (error) {
      console.log(
        `   ❌ Failed to scrape ${result.url.substring(0, 30)}: ${error.message}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`🤖 AI qualifying ${scrapedData.length} sources...`);
  await logBackgroundProgress(userId, sessionId, "job_search", `Running AI lead qualification on ${scrapedData.length} scraped source(s)...`);
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
    await logBackgroundProgress(userId, sessionId, "job_search", "AI Lead qualification complete. No matches found.");
    return {
      success: false,
      error:
        "No qualified leads found. Sources might not be actual job postings.",
    };
  }

  console.log(`✅ Found ${qualified.qualifiedLeads.length} qualified leads`);
  await logBackgroundProgress(userId, sessionId, "job_search", `AI Lead qualification complete. Found ${qualified.qualifiedLeads.length} matching job(s).`);

  let leads = qualified.qualifiedLeads;

  if (includeContactInfo) {
    const hasHunter = !!process.env.HUNTER_API_KEY;
    const hasExa = !!process.env.EXA_API_KEY;
    console.log(
      `📧 Finding contact information for ${leads.length} lead(s) (Hunter: ${hasHunter ? "on" : "off"}, Exa: ${hasExa ? "on" : "off"})...`,
    );
    await logBackgroundProgress(userId, sessionId, "job_search", `Finding contact info & application emails for ${leads.length} lead(s)...`);

    let li = 0;
    for (const lead of leads) {
      li++;
      const label = lead.company || lead.name || "unknown";
      console.log(`   [${li}/${leads.length}] ${label}`);

      if (lead.company && process.env.HUNTER_API_KEY) {
        const hunterResult = await findEmailWithHunter(
          lead.company,
          lead.name,
          process.env.HUNTER_API_KEY,
        );

        if (hunterResult.success && hunterResult.emails?.length) {
          lead.foundEmails = hunterResult.emails;
          lead.emailSource = "hunter";
          console.log(
            `      ✉️ Hunter: ${hunterResult.emails.length} email(s)`,
          );
        } else {
          console.log(`      ✉️ Hunter: none`);
        }
      }

      if (!lead.foundEmails?.length && process.env.EXA_API_KEY) {
        const exaQuery = `${lead.name} ${lead.company} email address`;
        const exaResult = await searchWeb(exaQuery, "semantic", { limit: 3 });
        if (exaResult.success) {
          lead.foundEmails = extractEmailsFromResults(exaResult.results);
          lead.emailSource = "exa";
          console.log(
            `      ✉️ Exa: ${lead.foundEmails?.length || 0} email(s) from snippets`,
          );
        }
      }

      if (!lead.foundEmails?.length) {
        console.log(`      ✉️ No email found (add HUNTER_API_KEY / EXA_API_KEY)`);
      }
    }

    if (process.env.PROSPEO_API_KEY) {
      const highValueLeads = leads.filter((l) => l.relevanceScore > 85);
      const enriched = await enrichBatchLeads(
        highValueLeads,
        process.env.PROSPEO_API_KEY,
      );

      for (const enrichedLead of enriched) {
        const index = leads.findIndex((l) => l.name === enrichedLead.name);
        if (index !== -1) {
          leads[index] = { ...leads[index], ...enrichedLead };
        }
      }
    }
  }

  if (generateTemplates) {
    console.log(`✍️ Generating personalized email templates...`);
    await logBackgroundProgress(userId, sessionId, "job_search", `Drafting professional application emails & tailoring to profile...`);
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

  await logBackgroundProgress(userId, sessionId, "job_search", `Finished search and evaluation. Found ${finalLeads.length} relevant positions.`);

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
