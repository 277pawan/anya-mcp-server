// ai-intent-router.js - WITH REAL MCP INTEGRATION
import dotenv from "dotenv";
import normalizeDate from "../utils/helper/normalize-date.js";
import { chatWithGlobalFallback } from "../ai/llm-fallback.js";
import {
  getCalendar,
  getUpcomingEvents,
  searchEvents,
  createMeeting,
  searchNearbyPlaces,
  geocode,
  searchBooks,
} from "../mcp/mcp-client.js";
import { findLeadsForProposal } from "../search/leadPipeline.js";
import {
  DEFAULT_LEAD_FETCH_LIMIT,
  DEFAULT_MAX_LEADS,
} from "../search/leadPipelineDefaults.js";
import { getUserBioContext, sendProposalBatch } from "../services/email.service.js";
import { sendSmartNotification } from "../utils/notificationHelper.js";
import { CONFIG } from "../config/config.js";

dotenv.config({ quiet: true });

const APP_PACKAGE_MAP = {
  "youtube music": "com.google.android.apps.youtube.music",
  "youtubemusic": "com.google.android.apps.youtube.music",
  "yt music": "com.google.android.apps.youtube.music",
  "ytmusic": "com.google.android.apps.youtube.music",
  "youtube": "com.google.android.youtube",
  "whatsapp": "com.whatsapp",
  "gmail": "com.google.android.gm",
  "calendar": "com.google.android.calendar",
  "maps": "com.google.android.apps.maps",
  "google maps": "com.google.android.apps.maps",
  "browser": "com.android.chrome",
  "chrome": "com.android.chrome",
  "spotify": "com.spotify.music",
  "facebook": "com.facebook.katana",
  "instagram": "com.instagram.android",
  "twitter": "com.twitter.android",
  "x": "com.twitter.android",
  "telegram": "org.telegram.messenger",
  "linkedin": "com.linkedin.android",
  "play store": "com.android.vending",
  "playstore": "com.android.vending",
  "settings": "com.android.settings"
};

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
    userId: userContext.userId || process.env.DEFAULT_USER_ID,
    sessionId: userContext.sessionId || null,
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
    cloudflareModels: useHF ? ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/microsoft/phi-2"] : [],
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
async function classifyIntent(message, history = []) {
  const systemPrompt = `You are a precise intent classifier. Return ONLY valid JSON, no other text.`;

  // Provide last 5 turns of history max to save tokens
  const recentHistory = history.slice(-5);
  const historyText = recentHistory.length > 0 
    ? recentHistory.map(h => `${h.role}: ${h.content}`).join('\\n')
    : "No previous history in this session.";

  const currentDate = new Date();
  const currentDateStr = currentDate.toISOString().split('T')[0];
  const currentTimeStr = currentDate.toLocaleTimeString('en-US', { hour12: false });
  const currentMonth = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const prompt = `
    Classify the intent of the user's latest message given the conversation history.
    If the user's message is a follow-up, use the history to resolve missing entities (like location, query, etc).
    
    CURRENT DATE: ${currentDateStr} (${currentMonth})
    CURRENT TIME: ${currentTimeStr}
    
    HISTORY:
    ${historyText}
    
    LATEST MESSAGE: "${message}"
    
    Return JSON:
    {
      "intent": "casual|job_search|calendar|maps|books|email|application|followup|mixed|missing_info|device_control",
      "confidence": 0.95,
      "missing_fields_question": "If intent is known but required fields are missing, put your follow-up question here to ask the user, otherwise null",
      "entities": {
        "skills": ["skill1", "skill2"],
        "location": "string (e.g., 'Connaught Place', 'remote') or null",
        "date": "EXACT YYYY-MM-DD or null. Calculate this based on CURRENT DATE.",
        "fromDate": "EXACT YYYY-MM-DD or null. If user asks for a range like 'this month', calculate the first day.",
        "toDate": "EXACT YYYY-MM-DD or null. If user asks for a range like 'this month', calculate the last day.",
        "daysAhead": "Number (e.g., 7 for week, 30 for month) if asking for upcoming events, or null",
        "startDateTime": "EXACT ISO datetime string (e.g., 2025-06-01T11:00:00) if the user asks to schedule/create a meeting. If user says '11 am', combine with CURRENT DATE.",
        "endDateTime": "EXACT ISO datetime string for meeting end time, else null",
        "meetingSummary": "string for the new meeting title if creating a meeting (default to 'Meeting' if not specified), else null",
        "attendees": "Array of email addresses if user mentions who to invite, else null",
        "query": "string or null",
        "placeType": "string (e.g., 'hospital', 'restaurant') or null",
        "author": "string or null",
        "origin": "string or null",
        "destination": "string or null",
        "maxLeads": null,
        "generateTemplates": false,
        "objective": "job_hunting|freelance_pitch|b2b_sales",
        "employmentType": "full_time|freelance|contract|internship|part_time",
        "musicQuery": "string (e.g., a song name 'shape of you', artist, or 'jazz') or null",
        "appName": "string (e.g., 'youtube music', 'whatsapp', 'gmail', 'calendar', 'youtube', 'maps') or null",
        "url": "string (e.g., 'https://google.com') or null"
      }
    }
    
    Rules for Intents:
    - casual: general conversation, greeting, thanking.
    - job_search: freelance work, clients, full-time hiring.
    - calendar: schedule, meeting, day, week.
    - maps: finding physical locations, directions, near me.
    - books: book, author, novel.
    - email: send, check, inbox.
    - device_control: user requests to play music, play a specific song, check/open YouTube Music, open other mobile apps on their phone (like WhatsApp, Gmail, Calendar, Maps, Play Store, etc.), or open website URLs on their mobile phone.
    - mixed: TWO OR MORE distinct actionable intents.
    
    REQUIRED FIELDS PER INTENT (if missing from both message AND history, set intent to "missing_info" and provide missing_fields_question):
    - maps (get directions): 'origin' and 'destination' are required.
    - maps (search nearby): 'location' is required.
    - maps (geocode): 'location' is required.
    - books: 'query' or 'author' is required.
    - job_search: can default to 'general' query, no strictly required fields.
    - calendar: date defaults to 'today'. If creating a meeting, 'meetingSummary' and 'startDateTime' are required.
    - device_control: no strictly required fields (if user says "play music", musicQuery defaults to a default query or random music).
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
    cloudflareModels: ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/microsoft/phi-2"],
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
  const systemPrompt = `Your name is Anya. You are Anya, a warm and friendly companion. NEVER call yourself an AI, language model, bot, or a generic "personal assistant". If asked "who are you", "what is your name", "how are you", or similar, always state you are Anya, and respond warmly. Keep it brief (1-2 sentences).`;

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

      case "getUpcomingEvents":
        result = await getUpcomingEvents(cleanedParams.days, cleanedParams.maxResults);
        break;

      case "searchEvents":
        result = await searchEvents(cleanedParams.query, cleanedParams.from_date, cleanedParams.to_date, cleanedParams.maxResults);
        break;

      case "createMeeting":
        result = await createMeeting(
          cleanedParams.summary,
          cleanedParams.start_datetime,
          cleanedParams.end_datetime,
          cleanedParams.description,
          cleanedParams.location,
          cleanedParams.attendees,
          cleanedParams.add_google_meet
        );
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

      case "searchFreelanceJobs": {
        console.log(
          `🔎 Lead pipeline: maxLeads=${cleanedParams.maxLeads ?? DEFAULT_MAX_LEADS}, fetchLimit=${cleanedParams.fetchLimit ?? DEFAULT_LEAD_FETCH_LIMIT}`,
        );
        // Fetch live bio from DB instead of hardcoded strings
        const fbio = await getUserBioContext(cleanedParams.userId || process.env.DEFAULT_USER_ID);
        const freelanceUserCtx = fbio ? {
          name:   fbio.name,
          email:  fbio.email,
          role:   fbio.role,
          pitch:  fbio.pitch,
          skills: fbio.skills,
          github: fbio.github,
          linkedin: fbio.linkedin,
          availability: fbio.availability,
          resumeUrl: fbio.resumeUrl,
          resumeFileName: fbio.resumeFileName,
          lifeContext: fbio.lifeContext,
          pipelineSettings: cleanedParams.pipelineSettings,
        } : {
          name: "Pawan Bisht", role: "Full Stack Engineer",
          pitch: "I am a skilled Full Stack Engineer looking to solve your technical challenges.",
          pipelineSettings: cleanedParams.pipelineSettings,
        };
        result = await findLeadsForProposal(cleanedParams.query, {
          maxLeads: cleanedParams.maxLeads ?? DEFAULT_MAX_LEADS,
          fetchLimit: cleanedParams.fetchLimit,
          minScore: 50,
          generateTemplates: cleanedParams.generateTemplates !== false,
          objective: cleanedParams.objective || "freelance_pitch",
          userContext: freelanceUserCtx,
          sessionId: cleanedParams.sessionId,
          userId: cleanedParams.userId || userContext.userId || process.env.DEFAULT_USER_ID,
        });
        // Auto-send proposal emails if leads have emails and bio has resume
        if (result.success && result.leads?.length && fbio) {
          const proposalReady = result.leads
            .map(l => ({ ...l, score: l.relevanceScore || 0 }))
            .filter(l => l.email && l.proposal && l.score >= 80);

          if (proposalReady.length > 0) {
            console.log(`📧 Auto-sending ${proposalReady.length} proposal email(s) with resume (score >= 80)...`);
            const emailResults = await sendProposalBatch(proposalReady, fbio, {
              delayMs: 1500,
              userId: cleanedParams.userId || process.env.DEFAULT_USER_ID,
              sessionId: cleanedParams.sessionId,
            });
            result.emailsSent = emailResults.filter(r => r.success).length;
            result.emailResults = emailResults;
            // Fire notification
            if (result.emailsSent > 0) {
              await sendSmartNotification({
                type: 'lead_alert',
                userId: cleanedParams.userId || process.env.DEFAULT_USER_ID,
                title: '🚀 Proposals Sent!',
                body: `Anya just sent ${result.emailsSent} proposal email(s) with your resume attached.`,
              });
            }
          }
        }
        break;
      }

      case "searchGeneralJobs": {
        console.log(
          `🔎 Job pipeline: maxLeads=${cleanedParams.maxLeads ?? DEFAULT_MAX_LEADS}, fetchLimit=${cleanedParams.fetchLimit ?? DEFAULT_LEAD_FETCH_LIMIT}`,
        );
        const gbio = await getUserBioContext(cleanedParams.userId || process.env.DEFAULT_USER_ID);
        const generalUserCtx = gbio ? {
          name:   gbio.name,
          email:  gbio.email,
          role:   gbio.role,
          pitch:  gbio.pitch,
          skills: gbio.skills,
          github: gbio.github,
          linkedin: gbio.linkedin,
          availability: gbio.availability,
          resumeUrl: gbio.resumeUrl,
          resumeFileName: gbio.resumeFileName,
          pipelineSettings: cleanedParams.pipelineSettings,
        } : {
          name: "Pawan Bisht", role: "Full Stack Engineer",
          pitch: "I am a skilled Full Stack Engineer looking for impactful full-time opportunities.",
          pipelineSettings: cleanedParams.pipelineSettings,
        };
        result = await findLeadsForProposal(cleanedParams.query, {
          maxLeads: cleanedParams.maxLeads ?? DEFAULT_MAX_LEADS,
          fetchLimit: cleanedParams.fetchLimit,
          minScore: 50,
          generateTemplates: true, // Always generate templates so we can auto-apply if emails exist
          objective: "job_hunting",
          userContext: generalUserCtx,
          sessionId: cleanedParams.sessionId,
          userId: cleanedParams.userId || userContext.userId || process.env.DEFAULT_USER_ID,
        });

        // Auto-send proposal emails for general jobs if leads have emails and bio has resume
        if (result.success && result.leads?.length && gbio) {
          const proposalReady = result.leads
            .map(l => ({ ...l, score: l.relevanceScore || 0 }))
            .filter(l => l.email && l.proposal && l.score >= 80);

          if (proposalReady.length > 0) {
            console.log(`📧 Auto-sending ${proposalReady.length} job application email(s) with resume (score >= 80)...`);
            const emailResults = await sendProposalBatch(proposalReady, gbio, {
              delayMs: 1500,
              userId: cleanedParams.userId || process.env.DEFAULT_USER_ID,
              sessionId: cleanedParams.sessionId,
            });
            result.emailsSent = emailResults.filter(r => r.success).length;
            result.emailResults = emailResults;
            // Fire notification
            if (result.emailsSent > 0) {
              await sendSmartNotification({
                type: 'lead_alert',
                userId: cleanedParams.userId || process.env.DEFAULT_USER_ID,
                title: '🚀 Applications Sent!',
                body: `Anya just sent ${result.emailsSent} job application email(s) with your resume attached.`,
              });
            }
          }
        }
        break;
      }

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

  const classification = await classifyIntent(userMessage, userContext.history || []);
  console.log(
    `📋 Intent: ${classification.intent} (${Math.round(classification.confidence * 100)}%)`,
  );

  switch (classification.intent) {
    case "missing_info":
      return {
        action: "respond",
        response: classification.missing_fields_question || "Could you provide more details so I can help you?"
      };

    case "casual":
      // Let casual chat fall through to the main streaming Gemini/Groq chat pipeline
      // where it gets full system prompt context (User Profile, Mood, Struggles) and streams in real-time!
      return { action: "stream" };

    case "job_search":
      const searchMode = inferJobSearchMode(
        userMessage,
        classification.entities,
      );
      const targetTool =
        searchMode === "freelance"
          ? "searchFreelanceJobs"
          : "searchGeneralJobs";
      const executeJobSearch = async () => {
        let enhancedQuery = classification.entities.query || "";
        let searchMode = "direct";
        if (process.env.LLM_PROVIDER_PRIMARY !== "huggingface" && process.env.LLM_PROVIDER_FALLBACK !== "huggingface") {
          try {
            console.log("🤖 Generating enhanced search query...");
            const queryResponse = await chatWithGlobalFallback(
              [
                {
                  role: "system",
                  content: "You are an expert technical recruiter and boolean search master...",
                },
              ],
              `Convert this to a strict search query: "${userMessage}". Output ONLY the string.`,
            );
            if (queryResponse && queryResponse.text && !queryResponse.text.includes("error")) {
              enhancedQuery = queryResponse.text.replace(/["']/g, "").trim();
              searchMode = "ai-enhanced";
            }
          } catch (err) {
            console.warn("⚠️ AI query enhancement failed, falling back to basic extraction.");
          }
        }

        console.log(`🔍 Enhanced query (${searchMode}): "${enhancedQuery}"`);
        let jobResult = await callMCPTool(
          targetTool,
          buildLeadPipelineToolParams(classification, userContext, enhancedQuery),
        );

        if (!jobResult.result?.success || jobResult.result?.error === "No search results found") {
          console.log(`⚠️ Search failed with enhanced query. Retrying with original user message...`);
          jobResult = await callMCPTool(
            targetTool,
            buildLeadPipelineToolParams(classification, userContext, userMessage),
          );
        }
        return jobResult;
      };

      return {
        action: "background_task",
        tool: targetTool,
        response: `I've started scanning the web for ${classification.entities.employmentType || ''} ${targetTool === 'searchFreelanceJobs' ? 'freelance gigs' : 'roles'} in the background. This usually takes a few seconds. I'll let you know as soon as I have the results!`,
        execute: executeJobSearch
      };

    case "calendar": {
      /** Format a single meeting event into a readable sentence */
      function formatMeeting(m) {
        let line = `• ${m.summary || 'Untitled event'}`;
        if (m.start) line += ` at ${m.start}`;
        if (m.end) line += ` – ${m.end}`;
        if (m.location) line += ` (${m.location})`;
        if (m.meet_link) line += ` | Meet: ${m.meet_link}`;
        if (m.attendees && m.attendees.length > 0) line += ` | Attendees: ${m.attendees.join(', ')}`;
        return line;
      }

      /** Convert any calendar MCP result into a readable natural-language summary */
      function summarizeCalendarResult(mcpResult, dateLabel) {
        if (!mcpResult || mcpResult.error) {
          return `I wasn't able to fetch your calendar right now. Please try again in a moment.`;
        }

        // getMyCalendarDataByDate → { meetings: [...] }
        if (Array.isArray(mcpResult.meetings)) {
          if (mcpResult.meetings.length === 0) {
            return `You have no meetings or events scheduled for ${dateLabel}. Your calendar is clear!`;
          }
          const lines = mcpResult.meetings.map(formatMeeting);
          return `Here are your meetings for ${dateLabel}:\n${lines.join('\n')}`;
        }

        // getUpcomingEvents / searchEvents → { upcoming_events: [...] } or { results: [...] }
        const events = mcpResult.upcoming_events || mcpResult.results || [];
        if (!Array.isArray(events) || events.length === 0) {
          return `You have no upcoming events in that period. Your schedule is wide open!`;
        }
        const lines = events.map(formatMeeting);
        return `Here are your upcoming events:\n${lines.join('\n')}`;
      }

      if (classification.entities.meetingSummary && classification.entities.startDateTime) {
        // Fix LLM timezone and parsing issues
        let startIso = classification.entities.startDateTime;
        if (!startIso.includes('T')) {
          // LLM returned just a date, assume 9 AM
          startIso += 'T09:00:00';
        }
        
        let start = new Date(startIso);
        
        // If LLM returned midnight (e.g., T00:00:00) but user probably wanted daytime, it might have failed time extraction.
        // But we must trust the start object mostly.
        // A safer way is to just use the start object.
        
        let endTimeStr = classification.entities.endDateTime;
        let endTime;
        if (!endTimeStr) {
          endTime = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
        } else {
          endTime = new Date(endTimeStr).toISOString();
        }
        
        const finalStartIso = start.toISOString();
        
        console.log(`📅 Creating meeting: ${classification.entities.meetingSummary} at ${finalStartIso} with ${classification.entities.attendees?.join(', ') || 'no attendees'}`);
        const raw = await callMCPTool("createMeeting", {
          summary: classification.entities.meetingSummary,
          start_datetime: finalStartIso,
          end_datetime: endTime,
          attendees: classification.entities.attendees,
        });
        const summary = raw.result?.success 
          ? `Successfully created the meeting '${classification.entities.meetingSummary}'. It's scheduled for ${new Date(classification.entities.startDateTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.`
          : `I couldn't create the meeting. Error: ${raw.result?.error || "Unknown error"}`;
        return {
          ...raw,
          result: { summary }
        };
      }

      if (classification.entities.fromDate && classification.entities.toDate) {
        console.log(`📅 Fetching events from ${classification.entities.fromDate} to ${classification.entities.toDate}`);
        const raw = await callMCPTool("searchEvents", {
          from_date: classification.entities.fromDate,
          to_date: classification.entities.toDate,
          maxResults: 50
        });
        const label = `${classification.entities.fromDate} to ${classification.entities.toDate}`;
        return {
          ...raw,
          result: { summary: summarizeCalendarResult(raw.result, label) }
        };
      }

      if (classification.entities.daysAhead) {
        console.log(`📅 Fetching upcoming events for ${classification.entities.daysAhead} days`);
        const raw = await callMCPTool("getUpcomingEvents", {
          days: classification.entities.daysAhead,
          maxResults: 50
        });
        const label = `the next ${classification.entities.daysAhead} days`;
        return {
          ...raw,
          result: { summary: summarizeCalendarResult(raw.result, label) }
        };
      }

      const date = classification.entities.date || "today";
      const normalizedDate = normalizeDate(date);
      const dateDisplayLabel = date === "today"
        ? "today"
        : new Date(normalizedDate).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
      console.log(`📅 Normalized date: ${date} → ${normalizedDate}`);
      const raw = await callMCPTool("getMyCalendarDataByDate", { date: normalizedDate });
      return {
        ...raw,
        result: { summary: summarizeCalendarResult(raw.result, dateDisplayLabel) }
      };
    }

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

    case "device_control": {
      const { musicQuery, appName, url: entityUrl } = classification.entities;
      
      let command = "open_app";
      let query = null;
      let packageName = null;
      let url = null;
      let responseText = "";

      const isMusicRequest = musicQuery !== null || /play\s+(some\s+)?music|songs?/i.test(userMessage) || (/youtube\s+music/i.test(userMessage) && /play/i.test(userMessage));

      // Try to extract URL manually as a fallback
      const urlRegex = /(https?:\/\/[^\s]+)/gi;
      const domainRegex = /([a-zA-Z0-9-]+\.[a-zA-Z]{2,6}[^\s]*)/gi;
      const manualUrlMatch = userMessage.match(urlRegex) || userMessage.match(domainRegex);
      const manualUrl = manualUrlMatch ? (manualUrlMatch[0].startsWith('http') ? manualUrlMatch[0] : 'https://' + manualUrlMatch[0]) : null;

      if (isMusicRequest) {
        command = "play_music";
        query = musicQuery || "random songs";
        
        let videoId = null;
        try {
          console.log(`[ai-intent-router] Resolving music query: "${query}"`);
          const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
          const res = await fetch(searchUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
            }
          });
          if (res.ok) {
            const html = await res.text();
            const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
            if (match) {
              videoId = match[1];
              console.log(`[ai-intent-router] Resolved video ID: ${videoId}`);
            }
          }
        } catch (e) {
          console.error("[ai-intent-router] Failed to resolve music query to video ID:", e);
        }

        if (videoId) {
          url = `https://music.youtube.com/watch?v=${videoId}`;
          responseText = `Sure! Playing "${query}" on YouTube Music.`;
        } else {
          url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
          responseText = `Sure! Opening YouTube Music for "${query}".`;
        }
      } else if (entityUrl || manualUrl) {
        command = "open_url";
        url = entityUrl || manualUrl;
        responseText = `Opening the link: ${url}`;
      } else if (appName) {
        const normalizedApp = appName.toLowerCase().trim();
        packageName = APP_PACKAGE_MAP[normalizedApp] || null;
        
        if (packageName) {
          responseText = `Opening ${appName}...`;
        } else {
          // If we don't have the package, guess it
          packageName = `com.google.android.apps.${normalizedApp}`;
          responseText = `Opening ${appName}...`;
        }
      } else {
        // Fallback: check if we can parse app name using simple words
        const openAppMatch = userMessage.match(/open\s+([a-zA-Z0-9\s]+)/i);
        if (openAppMatch) {
          const guessedAppName = openAppMatch[1].trim().toLowerCase();
          packageName = APP_PACKAGE_MAP[guessedAppName] || `com.google.android.apps.${guessedAppName}`;
          responseText = `Opening ${openAppMatch[1]}...`;
        } else {
          command = "play_music";
          query = "some music";
          responseText = "Sure, playing some music on YouTube Music for you!";
        }
      }

      return {
        action: "device_command",
        command,
        query,
        packageName,
        url,
        response: responseText
      };
    }

    case "email": {
      // Handle both "send email to X" and "compose email for Y"
      const emailInstruction = userMessage;
      const attachResume = /resume|cv|attach/i.test(emailInstruction);

      // Let AI compose + send — pass userId so it can fetch bio from DB
      const userId = userContext.userId || process.env.DEFAULT_USER_ID;
      const bio = await getUserBioContext(userId);

      const emailAI = await chatWithGlobalFallback({
        taskName: 'email_compose_router',
        messages: [
          {
            role: 'system',
            content: `You are an expert email composer for ${bio?.name || 'the user'}.
Sender context: Name=${bio?.name}, Email=${bio?.email}, Skills=${bio?.skills}, GitHub=${bio?.github}.
Extract recipient and compose a professional email from the instruction.
Output ONLY JSON: {"to":"email","subject":"subject","body":"body text"}`,
          },
          { role: 'user', content: emailInstruction },
        ],
        groqModels: ['llama-3.3-70b-versatile'],
        mistralModels: ['mistral-small-latest'],
        githubModels: ['gpt-4o-mini'],
        temperature: 0.35,
        maxTokens: 500,
        responseFormat: { type: 'json_object' },
      });

      if (!emailAI.success) {
        return { action: 'respond', response: 'I had trouble composing that email. Please try again.' };
      }

      let composed;
      try {
        let txt = emailAI.content.trim()
          .replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/```$/, '');
        const jS = txt.indexOf('{'), jE = txt.lastIndexOf('}');
        if (jS !== -1 && jE !== -1) txt = txt.substring(jS, jE + 1);
        composed = JSON.parse(txt);
      } catch (_) {
        return { action: 'respond', response: 'I composed the email but could not parse the result. Try using /api/email/compose directly.' };
      }

      if (!composed.to || !composed.subject || !composed.body) {
        return {
          action: 'respond',
          response: `I couldn't identify the recipient's email. Could you please include the email address? For example: "send email to john@example.com saying..."`,
        };
      }

      const { sendEmail: sendEmailFn } = await import('../services/email.service.js');
      const sendResult = await sendEmailFn({
        to:            composed.to,
        subject:       composed.subject,
        body:          composed.body,
        fromName:      bio?.name,
        attachmentUrl: attachResume ? bio?.resumeUrl  : null,
        attachmentName:attachResume ? bio?.resumeFileName : null,
      });

       if (sendResult.success) {
        let note = '';
        if (attachResume && !bio?.resumeUrl) {
          note = '\n\n⚠️ *Note:* I sent the email, but could not attach your resume because no resume is uploaded in your Profile Settings. Please upload a PDF resume in Settings so I can include it next time!';
        } else if (!bio?.resumeUrl) {
          note = '\n\n💡 *Tip:* You haven\'t uploaded a resume in Settings yet. Uploading a PDF resume there allows me to automatically attach it to cold emails!';
        } else if (!attachResume) {
          note = '\n\n💡 *Tip:* You have a resume uploaded. Next time, you can ask me to "attach my resume" to include it in the cold email!';
        }

        // Also check if they are missing LinkedIn/GitHub links to make it the "best email"
        const missingLinks = [];
        if (!bio?.linkedin) missingLinks.push('LinkedIn profile');
        if (!bio?.github) missingLinks.push('GitHub URL');
        if (missingLinks.length > 0) {
          note += `\n\n💡 *Improvement Tip:* To make this a highly-converting cold email, consider adding your ${missingLinks.join(' and ')} in Profile Settings.`;
        }

        return {
          action: 'respond',
          success: true,
          tool: 'gmail_send',
          params: { to: composed.to, subject: composed.subject, attachResume },
          result: sendResult,
          response: `✅ Done! I've sent your email to **${composed.to}** with subject "${composed.subject}"${attachResume && bio?.resumeUrl ? ' and attached your resume.' : '.'}${note}`,
          emailResult: sendResult,
        };
      } else {
        return {
          action: 'respond',
          success: false,
          tool: 'gmail_send',
          params: { to: composed.to, subject: composed.subject, attachResume },
          result: sendResult,
          response: `❌ I composed the email but couldn't send it: ${sendResult.error}. Please check your Gmail OAuth credentials.`,
        };
      }
    }

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
          "⚠️ Intent claimed 'mixed' but no subIntents found. Forcing casual chat stream.",
        );
        classification.intent = "casual";
        return { action: "stream" };
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
