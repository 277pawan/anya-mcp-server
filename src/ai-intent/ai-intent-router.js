// ai-intent-router.js - WITH REAL MCP INTEGRATION
import Groq from "groq-sdk";
import dotenv from "dotenv";
import normalizeDate from "../utils/helper/normalize-date.js";
import {
  getCalendar,
  searchNearbyPlaces,
  geocode,
  searchBooks,
} from "../mcp/mcp-client.js";

dotenv.config({ quiet: true });

// ============================================
// INITIALIZE GROQ CLIENT
// ============================================
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ============================================
// MODEL STRATEGY
// ============================================
const MODELS = {
  INTENT_CLASSIFIER: "qwen/qwen3-32b",
  QUERY_ENHANCER: "llama-3.3-70b-versatile",
  PROPOSAL_GENERATOR: "mixtral-8x7b-32768",
  CASUAL_CHAT: "llama-3.1-8b-instant",
};

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
// GENERIC GROQ CALL
// ============================================
async function callGroq(prompt, systemPrompt, model, maxTokens = 500) {
  if (!checkRateLimit()) {
    return { success: false, error: "Daily rate limit exceeded" };
  }

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      model: model,
      temperature: 0.3,
      max_tokens: maxTokens,
    });

    trackRequest();
    return {
      success: true,
      content: completion.choices[0]?.message?.content || "",
      usage: completion.usage,
    };
  } catch (error) {
    console.error("GROQ API Error:", error);
    return { success: false, error: error.message };
  }
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
        "author": "string or null"
      }
    }
    
    Rules:
    - casual: hi, hello, how are you, thanks, small talk
    - job_search: find, search, look for, jobs, freelance, work
    - calendar: schedule, meeting, calendar, day, week
    - maps: directions, near me, places, restaurant, hospital, coffee
    - books: book, author, read, novel
    - email: send, check, inbox, email
    - application: apply, proposal, submit
    - followup: follow up, reminder, check status
    - mixed: multiple requests in one message
  `;

  const result = await callGroq(
    prompt,
    systemPrompt,
    MODELS.INTENT_CLASSIFIER,
    300,
  );

  if (!result.success) {
    return { intent: "casual", confidence: 0.5, entities: {} };
  }

  try {
    let cleanJson = result.content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
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

  const prompt = `
    Enhance this job search query.
    
    ORIGINAL: "${originalMessage}"
    SKILLS: ${extractedEntities.skills?.join(", ") || "any"}
    LOCATION: ${extractedEntities.location || "remote"}
    
    Rules:
    - Add "freelance", "contract", "remote" keywords
    - Expand tech abbreviations (React → React.js)
    - Keep under 10 words
    
    Example: "react work" → "React.js developer freelance remote"
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

  return result.content.trim();
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
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
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
        result = {
          status: "pending",
          message: "Job search integration coming soon",
          query: cleanedParams.query,
          location: cleanedParams.location,
          skills: cleanedParams.skills,
        };
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
      const enhancedQuery = await enhanceJobQuery(
        userMessage,
        classification.entities,
      );
      console.log(`🔍 Enhanced query: "${enhancedQuery}"`);
      return await callMCPTool("searchFreelanceJobs", {
        query: enhancedQuery,
        location: classification.entities.location || "remote",
        skills: classification.entities.skills || [],
      });

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
      for (const subIntent of classification.entities.subIntents || []) {
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
