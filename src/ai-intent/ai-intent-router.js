// ai-intent-router.js - WITH REAL MCP INTEGRATION
import dotenv from "dotenv";
import normalizeDate from "../utils/helper/normalize-date.js";
import { chatWithGlobalFallback } from "../ai/llm-fallback.js";
import {
  getCalendar,
  searchNearbyPlaces,
  geocode,
  searchBooks,
} from "../mcp/mcp-client.js";
import { findLeadsForProposal } from "../search/leadPipeline.js";
import {
  DEFAULT_LEAD_FETCH_LIMIT,
  DEFAULT_MAX_LEADS,
} from "../search/leadPipelineDefaults.js";

dotenv.config({ quiet: true });

function resolvePipelineMaxLeads(entities, pipeline) {
  const raw = entities?.maxLeads ?? pipeline?.maxLeads;
  if (raw == null || raw === "") return DEFAULT_MAX_LEADS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_LEADS;
}

function resolvePipelineFetchLimit(pipeline) {
  const raw = pipeline?.fetchLimit;
  if (raw == null || raw === "") return DEFAULT_LEAD_FETCH_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LEAD_FETCH_LIMIT;
}

/** Params for searchFreelanceJobs / searchGeneralJobs; limits come from UI/DB via userContext.pipelineSettings unless the user explicitly asks for a count. */
function buildLeadPipelineToolParams(classification, userContext, query) {
  const pipeline = userContext.pipelineSettings || {};
  const entities = classification.entities || {};
  return {
    query,
    location: entities.location || "remote",
    skills: entities.skills || [],
    maxLeads: resolvePipelineMaxLeads(entities, pipeline),
    fetchLimit: resolvePipelineFetchLimit(pipeline),
    pipelineSettings: pipeline,
    generateTemplates: entities.generateTemplates,
    objective: entities.objective,
  };
}

// ============================================
// MODEL STRATEGY
// ============================================
const MODELS = {
  INTENT_CLASSIFIER: "qwen/qwen3-32b",
  QUERY_ENHANCER: "llama-3.3-70b-versatile", // fallback if Gemini fails
  PROPOSAL_GENERATOR: "mixtral-8x7b-32768",
  CASUAL_CHAT: "llama-3.1-8b-instant",
};

function inferJobSearchMode(userMessage, entities = {}) {
  const msg = userMessage.toLowerCase();
  const employmentType = String(entities.employmentType || "").toLowerCase();
  const objective = String(entities.objective || "").toLowerCase();

  const wantsFreelance =
    /freelanc|contractor|\bupwork\b|\bgig\b|client work|project[-\s]based/.test(
      msg,
    ) ||
    employmentType === "freelance" ||
    employmentType === "contract" ||
    objective === "freelance_pitch";

  const rejectsFreelance =
    /only full[-\s]?time|full[-\s]?time only|permanent (job|role)|not (interested in )?freelanc|no contract/.test(
      msg,
    );

  if (wantsFreelance && !rejectsFreelance) return "freelance";

  const text = `${userMessage} ${employmentType} ${objective}`.toLowerCase();
  const freelanceSignals =
    /freelance|contract|gig|upwork|toptal|proposal|b2b_sales/.test(text);
  const fulltimeSignals =
    /full[-\s]?time|mnc|corporate|permanent|salary|\bemployment\b|software\s*engineer|software\s*developer|full[-\s]?stack|backend|frontend|sde/.test(
      text,
    );

  if (freelanceSignals && !fulltimeSignals) return "freelance";
  if (fulltimeSignals && !freelanceSignals) return "general";

  return "general";
}

/** Appends site: clause if the model dropped it (Exa/Brave need this for job boards). */
function ensureJobSearchPlatformClause(query, platformHint) {
  const hint = platformHint.trim();
  if (!hint) return query.trim();
  const q = query.trim();
  if (q.includes(hint)) return q;
  return `${q} ${hint}`.trim();
}

// ============================================
// RATE LIMIT TRACKING
// ============================================
let requestsToday = 0;
const DAILY_LIMIT = 14000;
let lastResetDate = new Date().toDateString();

function checkRateLimit() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    requestsToday = 0;
    lastResetDate = today;
    console.log("🔄 Daily rate limit reset");
  }
  if (requestsToday >= DAILY_LIMIT) {
    console.warn(`⚠️ Daily limit reached: ${requestsToday}/${DAILY_LIMIT}`);
    return false;
  }
  return true;
}

function trackRequest() {
  requestsToday++;
  console.log(
    `📊 Requests today: ${requestsToday} / ${DAILY_LIMIT} (${Math.round((requestsToday / DAILY_LIMIT) * 100)}%)`,
  );
}

function cleanParams(params) {
  const cleaned = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

// ============================================
// GENERIC LLM CALL (Groq primary + Mistral fallback)
// (unchanged – kept for other tasks)
// ============================================
async function callGroq(prompt, systemPrompt, model, maxTokens = 500, useHF = true) {
  if (!checkRateLimit()) {
    return { success: false, error: "Daily rate limit exceeded" };
  }

  const completion = await chatWithGlobalFallback({
    taskName: `AI intent router (${model})`,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    githubModels: useHF ? ["gpt-4o-mini"] : [],
    cloudflareModels: useHF ? ["@cf/microsoft/phi-2"] : [],
    groqModels: [model],
    mistralModels: ["mistral-small-latest"],
    temperature: 0.3,
    maxTokens,
  });

  if (completion.success) {
    trackRequest();
    return {
      success: true,
      content: completion.content || "",
      usage: completion.usage,
      provider: completion.provider,
      model: completion.model,
    };
  }

  console.error("LLM API Error:", completion.error);
  return { success: false, error: completion.error };
}

// ============================================
// 1. INTENT CLASSIFIER (unchanged)
// ============================================
async function classifyIntent(message) {
  const systemPrompt = `You are a precise intent classifier. Return ONLY valid JSON, no other text.`;

  const prompt = `
    Classify this user message and extract entities.
    
    Message: "${message}"
    
    Return JSON:
    {
      "intent": "casual|job_search|calendar|maps|books|email|application|followup|mixed",
      "confidence": 0.95,
      "entities": {
        "skills": ["skill1", "skill2"],
        "location": "string (e.g., 'Connaught Place', 'remote') or null",
        "date": "YYYY-MM-DD or null",
        "query": "string or null",
        "placeType": "string (e.g., 'hospital', 'restaurant') or null",
        "author": "string or null",
        "maxLeads": null,
        "generateTemplates": false,
        "objective": "job_hunting|freelance_pitch|b2b_sales",
        "employmentType": "full_time|freelance|contract|internship|part_time"
      }
    }
    
    Rules:
    - casual: hi, hello, how are you, thanks, small talk, asking for your name/identity, general conversation or any query that does not fit the actionable intents below.
    - job_search: searching specifically for jobs, freelance work, clients, leads, hiring, opportunities.
    - calendar: schedule, meeting, calendar, day, week
    - maps: finding physical locations, places, directions, near me, restaurant, hospital, coffee
    - books: book, author, read, novel
    - email: send, check, inbox, email
    - application: apply, proposal, submit
    - followup: follow up, reminder, check status
    - mixed: STRICTLY for requests containing TWO OR MORE distinct actionable intents (e.g. "find jobs AND check calendar"). Do NOT use "mixed" for single-topic sentences or casual chat.
    
    For job_search / leads:
    - Fill "skills", "location", "employmentType", and "objective" when inferable. Use rich "query" only if the user gave a clear role/stack phrase worth preserving verbatim.
    - maxLeads: MUST be null unless the user explicitly asks for a numeric cap (e.g. "only 5 leads", "top 3 companies"). Do NOT invent a number; the app supplies defaults from user settings.
    - generateTemplates: true only if they ask for draft emails or proposal text.
  `;

  const result = await callGroq(
    prompt,
    systemPrompt,
    MODELS.INTENT_CLASSIFIER,
    2000,
  );

  if (!result.success) {
    return { intent: "casual", confidence: 0.5, entities: {} };
  }

  try {
    let cleanJson = result.content
      .replace(/<think>[\s\S]*?<\/think>\n?/g, "")
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const jsonStart = cleanJson.indexOf("{");
    const jsonEnd = cleanJson.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1);
    } else {
      console.warn(
        "⚠️ Model hit token limit or returned no JSON. Defaulting to casual intent.",
      );
      return { intent: "casual", confidence: 0.5, entities: {} };
    }
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error("JSON Parse Error:", e);
    return { intent: "casual", confidence: 0.5, entities: {} };
  }
}

// ============================================
// 2. QUERY ENHANCER – *UPDATED* WITH GEMINI FIRST
// ============================================
async function enhanceJobQuery(
  originalMessage,
  extractedEntities,
  searchMode = "general",
) {
  const systemPrompt = `You are a search query optimizer. Return ONLY the enhanced query string, no explanations.`;
  const employmentType = extractedEntities.employmentType || "full_time";
  const objective = extractedEntities.objective || "job_hunting";
  const freelanceFlavor =
    searchMode === "freelance" ||
    employmentType === "freelance" ||
    objective === "freelance_pitch";

  const roleHint = extractedEntities.skills?.length
    ? `${extractedEntities.skills.join(", ")}, software engineer, full-stack developer`
    : "software engineer, full-stack developer, web developer";
  const jobHint = freelanceFlavor
    ? "freelance, contract, remote, apply"
    : "full-time, hiring, careers, apply, software engineer, full-stack developer";

  const platformHint = freelanceFlavor
    ? "(site:linkedin.com/jobs OR site:linkedin.com/posts OR site:upwork.com OR site:wellfound.com OR site:arc.dev OR site:indeed.com OR site:in.indeed.com OR site:foundit.in)"
    : "(site:linkedin.com/jobs OR site:naukri.com OR site:indeed.com OR site:in.indeed.com OR site:foundit.in OR site:instahyre.com OR site:wellfound.com OR site:apna.co OR site:monsterindia.com OR site:jobtatkal.com)";

  const prompt = `
    Turn this into ONE high-recall web search query for real job postings and hiring posts (NOT blog articles, contract templates, legal templates, or tutorials).
    
    ORIGINAL: "${originalMessage}"
    SKILLS: ${extractedEntities.skills?.join(", ") || "any"}
    LOCATION: ${extractedEntities.location || "remote"}
    ROUTER_SEARCH_MODE: ${searchMode}
    EMPLOYMENT_TYPE: ${employmentType}
    OBJECTIVE: ${objective}
    
    Rules:
    - Prefer phrases: job opening, hiring, careers, apply now, role posted — avoid "contract template" or "sample agreement".
    - LinkedIn: real listings and recruiter posts; include "we are hiring" or "looking for" when ROUTER_SEARCH_MODE is freelance.
    - If IT/software, bias toward: ${roleHint}
    - Add these flavor keywords: ${jobHint}
    - You SHOULD end with this platform clause (copy verbatim): ${platformHint}
    - Expand tech abbreviations (React → React.js). No question marks. Under 70 words.
    
    Example: "react work" → "React.js developer remote hiring apply ${platformHint}"
  `;

  // ---- NEW: use Gemini with Groq/Mistral as fallback ----
  const result = await chatWithGlobalFallback({
    taskName: "Query enhancer (Gemini first)",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    githubModels: ["gpt-4o-mini"],
    cloudflareModels: ["@cf/microsoft/phi-2"],
    geminiModels: ["gemini-2.5-flash"], // free & fast
    groqModels: [MODELS.QUERY_ENHANCER], // fallback if Gemini fails
    mistralModels: ["mistral-small-latest"],
    temperature: 0.3,
    maxTokens: 100,
  });

  let q = originalMessage.trim();
  if (result.success) {
    trackRequest(); // still count towards daily limit to stay safe
    q = result.content.replace(/^"|"$/g, "").trim();
  } else {
    console.warn(
      "⚠️ Query enhancer failed, using original message + platform clause",
    );
  }

  if (
    !/\b(hiring|jobs?\b|careers|vacanc|opening|apply|role posted)\b/i.test(q)
  ) {
    q = `${q} job opening hiring apply`.trim();
  }

  return ensureJobSearchPlatformClause(q, platformHint);
}

// ============================================
// 3. CASUAL CHAT (unchanged)
// ============================================
async function handleCasualChat(message) {
  const systemPrompt = `You are Anya, a highly capable and friendly personal assistant. Never refer to yourself as an AI, artificial intelligence, or language model. Respond briefly (1-2 sentences), warmly, and be helpful.`;

  const result = await callGroq(message, systemPrompt, MODELS.CASUAL_CHAT, 150, false);

  return {
    action: "respond",
    response: result.success
      ? result.content
      : "Hello! How can I help you today?",
  };
}

// ============================================
// 4. PROPOSAL GENERATOR (unchanged)
// ============================================
async function generateProposalWithAI(jobDescription, userProfile) {
  const systemPrompt = `You are a professional freelance proposal writer. Return valid JSON with "subject" and "body" fields.`;

  const prompt = `
    Write a freelance proposal.
    
    JOB: ${jobDescription.substring(0, 1000)}
    MY SKILLS: ${userProfile?.skills?.slice(0, 5).join(", ") || "Full-stack development"}
    MY EXPERIENCE: ${userProfile?.experience || "5+ years"}
    
    Requirements:
    - Show you read the job
    - Highlight relevant experience
    - Ask 2 smart questions
    - Keep under 200 words
    
    Return JSON: {"subject": "...", "body": "..."}
  `;

  const result = await callGroq(
    prompt,
    systemPrompt,
    MODELS.PROPOSAL_GENERATOR,
    800,
  );

  if (!result.success) {
    return {
      subject: "Freelance Developer Application",
      body: "I'm interested in this position. Would love to discuss further.",
    };
  }

  try {
    let cleanJson = result.content
      .replace(/<think>[\s\S]*?<\/think>\n?/g, "")
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const jsonStart = cleanJson.indexOf("{");
    const jsonEnd = cleanJson.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1);
    }
    return JSON.parse(cleanJson);
  } catch {
    return {
      subject: "Freelance Developer Application",
      body: result.content,
    };
  }
}

// ============================================
// 5. MCP TOOL CALLER (unchanged)
// ============================================
async function callMCPTool(toolName, params) {
  console.log(`🔧 Calling MCP Tool: ${toolName}`);
  console.log(`📦 Original params:`, params);

  const cleanedParams = cleanParams(params);
  console.log(`🧹 Cleaned params:`, cleanedParams);

  try {
    let result;

    switch (toolName) {
      case "getMyCalendarDataByDate":
        result = await getCalendar(cleanedParams.date);
        break;

      case "searchNearbyPlaces":
        result = await searchNearbyPlaces(
          cleanedParams.location,
          cleanedParams.radius || 2000,
          cleanedParams.type,
          cleanedParams.keyword,
        );
        break;

      case "geocodeAddress":
        result = await geocode(cleanedParams.address);
        break;

      case "searchBooks":
        result = await searchBooks(
          cleanedParams.query,
          cleanedParams.maxResults || 5,
          cleanedParams.language,
        );
        break;

      case "getPlaceDetails":
        result = await getPlaceDetails(cleanedParams.place_id);
        break;

      case "getDirections":
        result = await getDirections(
          cleanedParams.origin,
          cleanedParams.destination,
          cleanedParams.mode || "driving",
        );
        break;

      case "searchPlaces":
        result = await searchPlaces(cleanedParams.query);
        break;

      case "searchFreelanceJobs":
        console.log(
          `🔎 Lead pipeline: maxLeads=${cleanedParams.maxLeads ?? DEFAULT_MAX_LEADS}, fetchLimit=${cleanedParams.fetchLimit ?? DEFAULT_LEAD_FETCH_LIMIT}`,
        );
        result = await findLeadsForProposal(cleanedParams.query, {
          maxLeads: cleanedParams.maxLeads ?? DEFAULT_MAX_LEADS,
          fetchLimit: cleanedParams.fetchLimit,
          minScore: 50,
          generateTemplates: cleanedParams.generateTemplates !== false,
          objective: cleanedParams.objective || "freelance_pitch",
          userContext: {
            name: "Pawan Bisht",
            role: "Developer",
            pitch:
              "I am a skilled developer looking to solve your technical challenges.",
            pipelineSettings: cleanedParams.pipelineSettings,
          },
        });
        break;

      case "searchGeneralJobs":
        console.log(
          `🔎 Job pipeline: maxLeads=${cleanedParams.maxLeads ?? DEFAULT_MAX_LEADS}, fetchLimit=${cleanedParams.fetchLimit ?? DEFAULT_LEAD_FETCH_LIMIT}`,
        );
        result = await findLeadsForProposal(cleanedParams.query, {
          maxLeads: cleanedParams.maxLeads ?? DEFAULT_MAX_LEADS,
          fetchLimit: cleanedParams.fetchLimit,
          minScore: 50,
          generateTemplates: cleanedParams.generateTemplates === true,
          objective: "job_hunting",
          userContext: {
            name: "Pawan Bisht",
            role: "Developer",
            pitch:
              "I am a skilled developer looking for impactful full-time opportunities.",
            pipelineSettings: cleanedParams.pipelineSettings,
          },
        });
        break;

      default:
        console.warn(`⚠️ Unknown tool: ${toolName}`);
        result = { error: `Tool ${toolName} not implemented yet` };
    }

    return {
      success: true,
      tool: toolName,
      params: cleanedParams,
      result,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`❌ MCP Tool ${toolName} failed:`, error.message);
    return {
      success: false,
      tool: toolName,
      params: cleanedParams,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ============================================
// 6. MAIN ROUTER (unchanged)
// ============================================
export async function routeUserMessage(userMessage, userContext = {}) {
  console.log(`\n🎯 Processing: "${userMessage}"`);

  const classification = await classifyIntent(userMessage);
  console.log(
    `📋 Intent: ${classification.intent} (${Math.round(classification.confidence * 100)}%)`,
  );

  switch (classification.intent) {
    case "casual":
      return await handleCasualChat(userMessage);

    case "job_search":
      const searchMode = inferJobSearchMode(
        userMessage,
        classification.entities,
      );
      const targetTool =
        searchMode === "freelance"
          ? "searchFreelanceJobs"
          : "searchGeneralJobs";
      const enhancedQuery = await enhanceJobQuery(
        userMessage,
        classification.entities,
        searchMode,
      );
      console.log(`🔍 Enhanced query (${searchMode}): "${enhancedQuery}"`);
      let jobResult = await callMCPTool(
        targetTool,
        buildLeadPipelineToolParams(classification, userContext, enhancedQuery),
      );

      if (
        !jobResult.result?.success ||
        jobResult.result?.error === "No search results found"
      ) {
        console.log(
          `⚠️ Search failed with enhanced query. Retrying with original user message...`,
        );
        jobResult = await callMCPTool(
          targetTool,
          buildLeadPipelineToolParams(classification, userContext, userMessage),
        );
      }

      return jobResult;

    case "calendar":
      const date = classification.entities.date || "today";
      const normalizedDate = normalizeDate(date);
      console.log(`📅 Normalized date: ${date} → ${normalizedDate}`);
      return await callMCPTool("getMyCalendarDataByDate", {
        date: normalizedDate,
      });

    case "maps":
      if (classification.entities.placeType) {
        return await callMCPTool("searchNearbyPlaces", {
          location: classification.entities.location || "current location",
          radius: 2000,
          type: classification.entities.placeType,
          keyword: null,
        });
      } else if (
        classification.entities.query &&
        classification.entities.query.includes("directions")
      ) {
        return await callMCPTool("getDirections", {
          origin: classification.entities.origin,
          destination: classification.entities.destination,
        });
      }
      return await callMCPTool("geocodeAddress", {
        address: classification.entities.location,
      });

    case "books":
      if (classification.entities.author) {
        return await callMCPTool("searchBooks", {
          query: `inauthor:${classification.entities.author}`,
          maxResults: 10,
        });
      }
      return await callMCPTool("searchBooks", {
        query: classification.entities.query,
        maxResults: 10,
      });

    case "email":
      return await callMCPTool("checkEmails", {
        query: classification.entities.emailQuery || "is:unread",
      });

    case "application":
      return {
        action: "application_pending",
        intent: "application",
        jobId: classification.entities.jobId,
        message: "Ready to generate proposal for this job. Send proposal?",
      };

    case "followup":
      return await callMCPTool("scheduleFollowup", {
        applicationId: classification.entities.applicationId,
        daysToWait: classification.entities.days || 5,
      });

    case "mixed":
      const results = [];
      const subIntents = classification.entities.subIntents || [];

      if (subIntents.length === 0) {
        console.warn(
          "⚠️ Intent claimed 'mixed' but no subIntents found. Forcing job search.",
        );
        classification.intent = "job_search";
        const fallbackMode = inferJobSearchMode(
          userMessage,
          classification.entities,
        );
        const fallbackEnhancedQuery = await enhanceJobQuery(
          userMessage,
          classification.entities,
          fallbackMode,
        );
        const fallbackTool =
          fallbackMode === "freelance"
            ? "searchFreelanceJobs"
            : "searchGeneralJobs";
        return await callMCPTool(
          fallbackTool,
          buildLeadPipelineToolParams(
            classification,
            userContext,
            fallbackEnhancedQuery,
          ),
        );
      }

      for (const subIntent of subIntents) {
        const subResult = await routeUserMessage(subIntent.query, userContext);
        results.push(subResult);
      }
      return { action: "mixed_results", results };

    default:
      return { error: "Unknown intent", originalMessage: userMessage };
  }
}

// ============================================
// STATUS CHECK (unchanged)
// ============================================
export function getStatus() {
  return {
    requestsToday,
    dailyLimit: DAILY_LIMIT,
    remaining: DAILY_LIMIT - requestsToday,
    resetDate: lastResetDate,
    models: MODELS,
  };
}

export default {
  routeUserMessage,
  getStatus,
  MODELS,
};
