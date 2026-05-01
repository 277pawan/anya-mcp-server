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

dotenv.config({ quiet: true });

// ============================================
// MODEL STRATEGY
// ============================================
const MODELS = {
  INTENT_CLASSIFIER: "qwen/qwen3-32b",
  QUERY_ENHANCER: "llama-3.3-70b-versatile",
  PROPOSAL_GENERATOR: "mixtral-8x7b-32768",
  CASUAL_CHAT: "llama-3.1-8b-instant",
};

function inferJobSearchMode(userMessage, entities = {}) {
  const objective = entities.objective || "";
  const employmentType = entities.employmentType || "";
  const text = `${userMessage} ${employmentType} ${objective}`.toLowerCase();

  const freelanceSignals =
    /freelance|contract|gig|client|upwork|toptal|proposal|b2b_sales/.test(text);
  const fulltimeSignals =
    /full[-\s]?time|mnc|company|corporate|permanent|salary|employment|job_hunting/.test(
      text,
    );

  if (freelanceSignals && !fulltimeSignals) return "freelance";
  if (fulltimeSignals && !freelanceSignals) return "general";

  // If uncertain, default to general job search intent.
  return "general";
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
// ============================================
async function callGroq(prompt, systemPrompt, model, maxTokens = 500) {
  if (!checkRateLimit()) {
    return { success: false, error: "Daily rate limit exceeded" };
  }

  const completion = await chatWithGlobalFallback({
    taskName: `AI intent router (${model})`,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
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
// 1. INTENT CLASSIFIER
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
        "location": "remote|city|country",
        "date": "YYYY-MM-DD or null",
        "query": "string or null",
        "placeType": "restaurant|hospital|cafe|etc",
        "author": "string or null",
        "maxLeads": "number (default 5)",
        "generateTemplates": "boolean (default false)",
        "objective": "job_hunting|freelance_pitch|b2b_sales (default job_hunting)",
        "employmentType": "full_time|freelance|contract|internship|part_time (default full_time)"
      }
    }
    
    Rules:
    - casual: hi, hello, how are you, thanks, small talk
    - job_search: find, search, look for, jobs, freelance, work, clients, leads.
    - calendar: schedule, meeting, calendar, day, week
    - maps: directions, near me, places, restaurant, hospital, coffee
    - books: book, author, read, novel
    - email: send, check, inbox, email
    - application: apply, proposal, submit
    - followup: follow up, reminder, check status
    - mixed: STRICTLY for completely unrelated requests (e.g. "find jobs AND check calendar"). Do NOT use "mixed" if they just want any type of jobs/leads; that is purely "job_search".
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
      .replace(/<think>[\s\S]*?<\/think>\n?/g, "") // Strip Qwen/DeepSeek thought blocks
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    // Sometimes it still returns text before JSON
    const jsonStart = cleanJson.indexOf("{");
    const jsonEnd = cleanJson.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1);
    } else {
      // If there is no '{', the model probably hit the token limit during <think>
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
// 2. QUERY ENHANCER
// ============================================
async function enhanceJobQuery(originalMessage, extractedEntities) {
  const systemPrompt = `You are a search query optimizer. Return ONLY the enhanced query string, no explanations.`;
  const employmentType = extractedEntities.employmentType || "full_time";
  const objective = extractedEntities.objective || "job_hunting";
  const jobHint =
    employmentType === "freelance" || objective === "freelance_pitch"
      ? "freelance, contract, remote"
      : "full-time, hiring, careers, role";

  const prompt = `
    Enhance this job search query.
    
    ORIGINAL: "${originalMessage}"
    SKILLS: ${extractedEntities.skills?.join(", ") || "any"}
    LOCATION: ${extractedEntities.location || "remote"}
    EMPLOYMENT_TYPE: ${employmentType}
    OBJECTIVE: ${objective}
    
    Rules:
    - Add these relevant intent keywords: ${jobHint}
    - Expand tech abbreviations (React → React.js)
    - Keep under 50 words
    
    Example (freelance): "react work" → "React.js developer freelance remote contract"
    Example (full-time): "react work" → "React.js Node.js full-time remote hiring fintech"
  `;

  const result = await callGroq(
    prompt,
    systemPrompt,
    MODELS.QUERY_ENHANCER,
    100,
  );

  if (!result.success) {
    return originalMessage;
  }

  // Strip literal quotes that AI might hallucinate around the string
  return result.content.replace(/^"|"$/g, "").trim();
}

// ============================================
// 3. CASUAL CHAT RESPONSE
// ============================================
async function handleCasualChat(message) {
  const systemPrompt = `You are JARVIS, a friendly AI assistant for a freelance developer. Respond briefly (1-2 sentences), warmly, and be helpful.`;

  const result = await callGroq(message, systemPrompt, MODELS.CASUAL_CHAT, 150);

  return {
    action: "respond",
    response: result.success
      ? result.content
      : "Hello! How can I help you today?",
  };
}

// ============================================
// 4. PROPOSAL GENERATOR
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
// 5. MCP TOOL CALLER - NOW WITH REAL IMPLEMENTATION!
// ============================================
async function callMCPTool(toolName, params) {
  console.log(`🔧 Calling MCP Tool: ${toolName}`);
  console.log(`📦 Original params:`, params);

  // CRITICAL: Remove null values
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
          cleanedParams.keyword, // undefined is fine, null is not
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
          `🔎 Using Lead Pipeline. Target leads: ${cleanedParams.maxLeads || 5}`,
        );
        result = await findLeadsForProposal(cleanedParams.query, {
          maxLeads: cleanedParams.maxLeads || 5,
          minScore: 50,
          generateTemplates: cleanedParams.generateTemplates !== false, // Default true if they ask for template
          objective: cleanedParams.objective || "freelance_pitch",
          userContext: {
            name: "Pawan Bisht",
            role: "Developer",
            pitch:
              "I am a skilled developer looking to solve your technical challenges.",
          },
        });
        break;
      case "searchGeneralJobs":
        console.log(
          `🔎 Using General Job Pipeline. Target leads: ${cleanedParams.maxLeads || 5}`,
        );
        result = await findLeadsForProposal(cleanedParams.query, {
          maxLeads: cleanedParams.maxLeads || 5,
          minScore: 50,
          generateTemplates: cleanedParams.generateTemplates === true,
          objective: "job_hunting",
          userContext: {
            name: "Pawan Bisht",
            role: "Developer",
            pitch:
              "I am a skilled developer looking for impactful full-time opportunities.",
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
// 6. MAIN ROUTER
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
      const searchMode = inferJobSearchMode(userMessage, classification.entities);
      const targetTool =
        searchMode === "freelance" ? "searchFreelanceJobs" : "searchGeneralJobs";
      const enhancedQuery = await enhanceJobQuery(
        userMessage,
        classification.entities,
      );
      console.log(`🔍 Enhanced query (${searchMode}): "${enhancedQuery}"`);
      let jobResult = await callMCPTool(targetTool, {
        query: enhancedQuery,
        location: classification.entities.location || "remote",
        skills: classification.entities.skills || [],
        maxLeads: classification.entities.maxLeads || 5,
        generateTemplates: classification.entities.generateTemplates,
        objective: classification.entities.objective,
      });

      // Automatic Retry Strategy: If enhanced query yields 0 results, retry with original query!
      if (!jobResult.result?.success || jobResult.result?.error === "No search results found") {
        console.log(`⚠️ Search failed with enhanced query. Retrying with original user message...`);
        jobResult = await callMCPTool(targetTool, {
          query: userMessage, // pure original message
          location: classification.entities.location || "remote",
          skills: classification.entities.skills || [],
          maxLeads: classification.entities.maxLeads || 5,
          generateTemplates: classification.entities.generateTemplates,
          objective: classification.entities.objective,
        });
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
        // Handle directions
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

      // Fail-safe: if classifier said mixed but provided no subIntents, default it back to job_search just in case!
      if (subIntents.length === 0) {
        console.warn("⚠️ Intent claimed 'mixed' but no subIntents found. Forcing job search.");
        classification.intent = "job_search";
        const fallbackEnhancedQuery = await enhanceJobQuery(userMessage, classification.entities);
        const fallbackMode = inferJobSearchMode(userMessage, classification.entities);
        const fallbackTool =
          fallbackMode === "freelance" ? "searchFreelanceJobs" : "searchGeneralJobs";
        return await callMCPTool(fallbackTool, {
          query: fallbackEnhancedQuery,
          location: classification.entities.location || "remote",
          skills: classification.entities.skills || [],
          maxLeads: classification.entities.maxLeads || 5,
          generateTemplates: classification.entities.generateTemplates,
          objective: classification.entities.objective,
        });
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
// STATUS CHECK
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
