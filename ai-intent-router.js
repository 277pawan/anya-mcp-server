// ai-intent-router.js - Complete with decision logic
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const deepseek = new OpenAI({
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

// Token tracker
let monthlyTokensUsed = 0;
const MONTHLY_FREE_LIMIT = 1000000; // 1M free monthly tokens

/**
 * MAIN ROUTER - Decides WHAT to do and WHICH function to call
 */
export async function routeUserMessage(userMessage, userContext = {}) {
  // ============================================
  // STEP 1: AI Classifies Intent & Extracts Entities
  // ============================================
  const classification = await classifyWithDeepSeek(userMessage);

  // ============================================
  // STEP 2: Based on Intent, Call Appropriate Function
  // ============================================
  switch (classification.intent) {
    case "casual":
      // No MCP, no tools - direct AI response
      return await handleCasualChat(userMessage);

    case "job_search":
      // AI ENHANCES the query before MCP call
      const enhancedQuery = await enhanceJobQuery(
        userMessage,
        classification.entities,
      );
      // Call MCP with enhanced params
      return await callMCPTool("searchFreelanceJobs", {
        query: enhancedQuery,
        location: classification.entities.location || "remote",
        skills: classification.entities.skills || [],
      });

    case "calendar":
      // Normalize date format
      const date = classification.entities.date || "today";
      const normalizedDate = normalizeDate(date);
      return await callMCPTool("getMyCalendarDataByDate", {
        date: normalizedDate,
      });

    case "email":
      return await callMCPTool("checkEmails", {
        query: classification.entities.emailQuery || "is:unread",
      });

    case "application":
      // Multiple steps: analyze → propose → send
      const jobAnalysis = await callMCPTool("analyzeJob", {
        jobId: classification.entities.jobId,
      });

      if (jobAnalysis.matchScore > 70) {
        const proposal = await generateProposalWithAI(
          jobAnalysis.jobDescription,
          userContext.profile,
        );
        return await callMCPTool("sendApplicationEmail", {
          to: classification.entities.employerEmail,
          subject: proposal.subject,
          body: proposal.body,
        });
      }
      return { status: "skipped", reason: "Match score too low" };

    case "mixed":
      // Parallel execution for multiple intents
      return await handleMixedIntent(classification, userContext);

    case "followup":
      return await callMCPTool("scheduleFollowup", {
        applicationId: classification.entities.applicationId,
        daysToWait: classification.entities.days || 5,
      });

    default:
      return { error: "Unknown intent", originalMessage: userMessage };
  }
}

/**
 * AI Classification Function - Calls DeepSeek to decide intent
 */
async function classifyWithDeepSeek(message) {
  const prompt = `
        Classify this user message and extract key entities.
        
        Message: "${message}"
        
        Return ONLY valid JSON:
        {
            "intent": "casual|job_search|calendar|email|application|followup|mixed",
            "confidence": 0.95,
            "entities": {
                "skills": ["React", "Node.js"],
                "location": "remote",
                "date": "2026-04-26",
                "jobId": "123",
                "employerEmail": "hiring@company.com"
            }
        }
        
        Rules:
        - For job_search: extract skills, location, remote preference
        - For calendar: extract date (default to today)
        - For mixed: detect multiple requests in one message
    `;

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You are an intent classifier. Return JSON only.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2, // Low temp for consistent classification
  });

  trackTokens(response.usage.total_tokens);

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return { intent: "casual", confidence: 0.5, entities: {} };
  }
}

/**
 * AI ENHANCES the query before MCP call - THIS IS THE KEY!
 */
async function enhanceJobQuery(originalMessage, extractedEntities) {
  const prompt = `
        Enhance this job search query for maximum results.
        
        ORIGINAL: "${originalMessage}"
        EXTRACTED SKILLS: ${extractedEntities.skills?.join(", ") || "any"}
        LOCATION: ${extractedEntities.location || "remote"}
        
        Enhance by:
        1. Adding relevant tech synonyms
        2. Adding "freelance", "contract", "remote" keywords
        3. Expanding abbreviations (React → React.js)
        
        Return ONLY the enhanced query string.
        
        Example: "react work" → "React.js developer freelance remote contract"
    `;

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You are a search query optimizer. Return only the enhanced query text.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 100,
  });

  trackTokens(response.usage.total_tokens);
  return response.choices[0].message.content.trim();
}

/**
 * Generate proposal using AI
 */
async function generateProposalWithAI(jobDescription, userProfile) {
  const prompt = `
        Write a professional freelance proposal.
        
        JOB: ${jobDescription.substring(0, 1500)}
        MY SKILLS: ${userProfile.skills?.join(", ")}
        MY EXPERIENCE: ${userProfile.experience}
        
        Return JSON: {"subject": "...", "body": "..."}
        
        Requirements:
        - Show you read the job
        - Highlight relevant experience
        - Ask 2 smart questions
        - Keep under 200 words
    `;

  const response = await deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You are a proposal writer. Return valid JSON.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7, // Higher temp for creative writing
  });

  trackTokens(response.usage.total_tokens);

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return {
      subject: "Freelance Developer Application",
      body: response.choices[0].message.content,
    };
  }
}

/**
 * Handle mixed intents in parallel
 */
async function handleMixedIntent(classification, userContext) {
  const subIntents = classification.entities.subIntents || [];
  const promises = [];

  for (const intent of subIntents) {
    switch (intent.type) {
      case "calendar":
        promises.push(
          callMCPTool("getMyCalendarDataByDate", { date: "today" }),
        );
        break;
      case "job_search":
        const enhanced = await enhanceJobQuery(intent.query, intent.entities);
        promises.push(callMCPTool("searchFreelanceJobs", { query: enhanced }));
        break;
      case "email":
        promises.push(callMCPTool("checkEmails", {}));
        break;
    }
  }

  const results = await Promise.all(promises);
  return { mixed: true, results };
}

/**
 * MCP Tool Caller - This connects to your MCP servers
 */
async function callMCPTool(toolName, params) {
  // This is where you'd make the actual MCP call
  // Using stdio transport to your MCP server
  console.log(`🔧 Calling MCP Tool: ${toolName}`, params);

  // TODO: Implement actual MCP transport
  // For now, return mock
  return {
    tool: toolName,
    params,
    status: "pending",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Token tracking to monitor free tier usage
 */
function trackTokens(tokensUsed) {
  monthlyTokensUsed += tokensUsed;
  console.log(
    `📊 Tokens used this month: ${monthlyTokensUsed} / ${MONTHLY_FREE_LIMIT}`,
  );

  if (monthlyTokensUsed > MONTHLY_FREE_LIMIT * 0.9) {
    console.warn(
      `⚠️ Approaching free tier limit! Used ${monthlyTokensUsed} of ${MONTHLY_FREE_LIMIT}`,
    );
  }
}

export { monthlyTokensUsed, MONTHLY_FREE_LIMIT };
