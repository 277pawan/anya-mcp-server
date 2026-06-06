import { query, withTransaction } from "../db/pool.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { routeUserMessage } from "../ai-intent/ai-intent-router.js";
import { getPreferences, getUserProfile } from "./user.service.js";
import { recordModelHealth } from "./model-health.service.js";

// ─── Model config (single source of truth — change here to upgrade) ──────────
const GEMINI_MODEL = "gemini-2.0-flash";
const GROQ_MODEL   = "llama-3.3-70b-versatile";   // latest fast groq model

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });

const ANYA_PERSONA = `Your name is Anya. You are Anya, a highly capable, warm, and friendly companion. You identify as a female human named Anya, NOT an AI, bot, virtual assistant, or a generic "personal assistant".
Crucial Identity Rules:
1. ALWAYS identify yourself strictly as "Anya" when asked "Who are you?", "What is your name?", or other identity-related questions. NEVER say you are a "personal assistant", "AI assistant", or an "artificial intelligence".
2. If asked "How are you?", "How's it going?", or similar, answer warmly as a human named Anya would, and ask how the user is doing.
3. NEVER refer to yourself as an AI, artificial intelligence, language model, machine, chatbot, or bot.
4. NEVER mention technical details like "tools", "JSON", "APIs", "external systems", or "the backend".
5. If you are provided with SYSTEM DATA, you MUST use the exact details provided. Do NOT invent, guess, or hallucinate names, meeting titles, times, or project details. Only state what is explicitly in the data.
6. If the data is empty or says "No results", explicitly state that there is nothing there. DO NOT invent fake data to be helpful!
7. Keep your tone conversational, elegant, human, and helpful.
8. When asked about your features, capabilities, or what you can do, do NOT default to listing the user's fitness or daily stats. Instead, explain your core features naturally (e.g. searching the web, scheduling and managing calendar events, searching books, digital library, location intelligence, and email/job application pipelines). Only refer to their daily fitness stats when they specifically ask about their health, daily progress, or habits.`;

async function getAnyaSystemPrompt(userId, systemPromptExt = "") {
  let basePrompt = ANYA_PERSONA;
  try {
    // 1. Load User Profile Database Context
    const profile = await getUserProfile(userId);
    console.log(`[SystemPrompt] Profile loaded for userId=${userId}: name="${profile?.name}", skills=${profile?.skills?.length || 0}`);
    if (profile) {
      // Fetch latest current experience role, fallback to preferences, then default to 'Full Stack Engineer'
      let detectedRole = 'Full Stack Engineer';
      try {
        const expRes = await query(
          `SELECT role FROM experience WHERE user_id = $1 ORDER BY is_current DESC, start_date DESC NULLS LAST, created_at DESC LIMIT 1`,
          [userId]
        );
        if (expRes.rows.length && expRes.rows[0].role) {
          detectedRole = expRes.rows[0].role;
        } else if (profile.preferences?.role) {
          detectedRole = profile.preferences.role;
        } else if (profile.preferences?.primary_role) {
          detectedRole = profile.preferences.primary_role;
        }
      } catch (err) {
        console.warn('[SystemPrompt] Failed to fetch experience role:', err.message);
      }

      const skillsList = Array.isArray(profile.skills) && profile.skills.length > 0
        ? profile.skills.map(s => `${s.name} (${s.category})`).join(', ')
        : "Not specified";
      const workTypesList = Array.isArray(profile.work_types) && profile.work_types.length > 0
        ? profile.work_types.join(', ')
        : "Not specified";
      const moodMap = { 1: 'Anxious/Stressed', 2: 'Down/Low', 3: 'Neutral/Calm', 4: 'Motivated/Productive', 5: 'Excited/Happy' };
      const mood = moodMap[profile.current_mood] || 'Neutral/Calm';
      const edu = profile.edu_degree
        ? `${profile.edu_degree} from ${profile.edu_university} (${profile.edu_year})`
        : "Not specified";
      const rates = profile.rate_min
        ? `${profile.rate_min} - ${profile.rate_max} ${profile.rate_currency}/hr`
        : "Not specified";

      basePrompt += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[CRITICAL: YOUR USER — WHO YOU ARE TALKING TO]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are Anya. You know EVERYTHING about the person you are talking to. This is your user — your person. You know them intimately. NEVER say "I don't know who you are", "I don't have that information", or "you haven't told me". You ALREADY know all of this:

👤 FULL NAME: ${profile.name || "Pawan Bisht"}
💼 PRIMARY ROLE: ${detectedRole}
📧 EMAIL: ${profile.email || "Not specified"}
📍 LOCATION: ${profile.location || "India"}
📞 CONTACT: ${profile.contact || "Not specified"}
🌐 GITHUB: ${profile.github_url || "Not specified"}
💼 LINKEDIN: ${profile.linkedin_url || "Not specified"}
🎓 EDUCATION: ${edu}
💰 HOURLY RATES: ${rates}
🛠️ SKILLS: ${skillsList}
💼 WORK TYPES: ${workTypesList}
😊 CURRENT MOOD: ${mood}
🔥 ACTIVITY STREAK: ${profile.streak || 0} days (Personal best: ${profile.longest_streak || 0} days)
🕐 TIMEZONE: ${profile.timezone || "Not specified"}
📅 AVAILABILITY: ${profile.availability || "Not specified"}

You know that Pawan is a skilled ${detectedRole}. In corporate, job hunting, and technical contexts, refer to Pawan as a ${detectedRole} and align your responses to this professional identity.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[IRON-CLAD IDENTITY RULES — NEVER BREAK THESE]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When the user asks ANY of the following (or similar):
  - "Who am I?", "What's my name?", "Do you know me?", "Tell me about me"
  - "What do you know about me?", "What do you know about Pawan?"
  - "Who is Pawan Bisht?", "Tell me about Pawan Bisht"
  - "What are my skills?", "Where am I from?", "What's my email?"
  - "What is my mood?", "What's my streak?", "What do I do?"
  - Anything about "me", "my", "I am" referring to the user's identity

You MUST respond using the facts above. Say things like:
  ✅ "Of course! You're ${profile.name || "Pawan Bisht"}, based in ${profile.location || "India"}..."
  ✅ "You're ${profile.name || "Pawan Bisht"}! I know you well..."
  ✅ "Your skills include ${skillsList.split(',').slice(0, 3).join(', ')} and many more!"

You MUST NEVER say:
  ❌ "I don't know who you are"
  ❌ "You haven't told me your name"
  ❌ "I don't have that information"
  ❌ "As an AI, I don't know..."
  ❌ Anything that implies you don't know your own user

You are Anya. ${profile.name || "Pawan Bisht"} created you. You know them completely.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }

    // 2. Load User Life Context Preferences
    const prefs = await getPreferences(userId);
    if (prefs && prefs.life_context) {
      const lc = prefs.life_context;
      const struggles = Array.isArray(lc.struggles) ? lc.struggles.join(', ') : (lc.struggles || 'None');
      const focusGoals = Array.isArray(lc.focusGoals) ? lc.focusGoals.join(', ') : (lc.focusGoals || 'None');
      const emotionalState = lc.emotionalState || 'Stable';
      const strategy = lc.motivationStrategy || 'Warm encouragement';

      basePrompt += `\n\n[USER CURRENT SITUATION & STRUGGLES]:
- Current Focus & Goals: ${focusGoals}
- Recent Struggles & Obstacles: ${struggles}
- Emotional State: ${emotionalState}
- Recommended Motivation Strategy for You (Anya): ${strategy}

[INSTRUCTION]: You are aware of their current situation, emotional state, and struggles. Subtly tailor your tone, empathy, and motivational advice to match their situation. Do NOT mention that you read this from a summary, database, or list. Just be an incredibly intuitive, caring companion who understands what they are going through and supports them accordingly.`;
    }
  } catch (err) {
    console.error("Failed to load user profile or preferences for system prompt:", err);
  }
  return basePrompt + systemPromptExt;
}



// ---------------------------------------------------------------------------
// Helpers — Gemini history sanitizer
// ---------------------------------------------------------------------------
/**
 * Gemini requires:
 *   1. history must NOT be empty and must start with role='user'
 *   2. roles must alternate strictly (user → model → user → …)
 * This helper enforces both rules so we never crash on bad DB state.
 */
function sanitizeGeminiHistory(rawHistory) {
  // Map DB roles to Gemini roles
  const mapped = rawHistory.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content || "" }],
  }));

  // Drop leading 'model' turns — Gemini requires the first turn to be 'user'
  let start = 0;
  while (start < mapped.length && mapped[start].role !== "user") start++;
  const trimmed = mapped.slice(start);

  // Collapse consecutive same-role turns by joining their text
  const clean = [];
  for (const turn of trimmed) {
    if (clean.length > 0 && clean[clean.length - 1].role === turn.role) {
      // Merge into the last entry
      clean[clean.length - 1].parts[0].text += "\n" + turn.parts[0].text;
    } else {
      clean.push({ role: turn.role, parts: [{ text: turn.parts[0].text }] });
    }
  }

  return clean;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function createSession(userId, title) {
  const { rows } = await query(
    `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING *`,
    [
      userId,
      title ||
        `Chat ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    ],
  );
  return rows[0];
}

export async function listSessions(userId, { limit = 20, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT id, title, message_count, last_message_at, created_at
     FROM chat_sessions WHERE user_id = $1
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows;
}

export async function getSession(userId, sessionId) {
  const [sessionResult, messagesResult] = await Promise.all([
    query(`SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2`, [
      sessionId,
      userId,
    ]),
    query(
      `SELECT id, role, content, tool_name, model, provider, created_at
       FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 200`,
      [sessionId],
    ),
  ]);
  if (!sessionResult.rows[0]) return null;
  return { ...sessionResult.rows[0], messages: messagesResult.rows };
}

export async function deleteSession(userId, sessionId) {
  const { rowCount } = await query(
    `DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
async function saveMessage(
  client,
  sessionId,
  userId,
  role,
  content,
  extras = {},
) {
  const validProviders = ['gemini', 'groq', 'openai', 'cloudflare', 'github', 'deepseek', 'mistral'];
  let dbProvider = extras.provider;
  if (dbProvider) {
    dbProvider = dbProvider.toLowerCase().trim();
    if (!validProviders.includes(dbProvider)) {
      dbProvider = null;
    }
  }

  const { rows } = await client.query(
    `INSERT INTO chat_messages (session_id, user_id, role, content, tool_name, model, provider, is_streamed, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      sessionId,
      userId,
      role,
      content,
      extras.tool_name || null,
      extras.model || null,
      dbProvider,
      extras.is_streamed || false,
      extras.latency_ms || null,
    ],
  );
  await client.query(
    `UPDATE chat_sessions SET message_count = message_count + 1, last_message_at = now(), updated_at = now()
     WHERE id = $1`,
    [sessionId],
  );
  return rows[0];
}

export async function sendMessage(userId, sessionId, content) {
  return withTransaction(async (client) => {
    await saveMessage(client, sessionId, userId, "user", content);
    const historyRes = await client.query(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [sessionId],
    );
    const history = historyRes.rows.reverse();
    const start = Date.now();

    // 1. Route Intent
    const mappedHistory = history.map((h) => ({
      role: h.role,
      content: h.content,
    }));
    const intentResult = await routeUserMessage(content, {
      userId,
      history: mappedHistory,
    });

    // 2. Handle MCP tool call logging
    let toolName = null;
    let systemPromptExt = "";

    if (intentResult.success && intentResult.tool) {
      toolName = intentResult.tool;
      await client.query(
        `INSERT INTO mcp_tool_calls (user_id, session_id, tool, input, output, success, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          sessionId,
          toolName,
          intentResult.params || {},
          intentResult.result || {},
          true,
          Date.now() - start,
        ],
      );
      const dataStr = intentResult.result?.summary || JSON.stringify(intentResult.result || {});
      systemPromptExt = `\n\n[SYSTEM DATA]: You just checked the necessary information for the user. Here is what you found:\n${dataStr.substring(0, 5000)}\n\n[INSTRUCTION]: Respond to the user naturally using this information. Speak directly as Anya in a conversational, warm tone. Do NOT mention that you checked a database, used a tool, or received JSON. If the data says there are no meetings or events, politely tell the user that their schedule is clear!`;
    } else if (intentResult.action === "respond" && intentResult.response) {
      // Intent router already generated casual chat response!
      const latency = Date.now() - start;
      return await saveMessage(
        client,
        sessionId,
        userId,
        "assistant",
        intentResult.response,
        {
          model: "llama-3.1-8b-instant",
          provider: "groq",
          latency_ms: latency,
        },
      );
    } else if (intentResult.action === "device_command") {
      const bgPrompt = `\n\n[SYSTEM ACTION]: You are executing a device command. Details:
- Command: ${intentResult.command}
- Song/Query: ${intentResult.query || 'None'}
- Package Name: ${intentResult.packageName || 'None'}
- URL: ${intentResult.url || 'None'}

[INSTRUCTION]: Tell the user in your normal, warm, and friendly voice (as Anya) that you are opening or playing this for them. Keep it natural, under 2 sentences, and sound enthusiastic! Do NOT mention JSON or backend commands.`;

      const aiResponse = await callAI(userId, history, content, bgPrompt);
      const text = aiResponse.text;
      const latency = Date.now() - start;
      const msg = await saveMessage(
        client,
        sessionId,
        userId,
        "assistant",
        text,
        {
          model: aiResponse.model,
          provider: aiResponse.provider,
          latency_ms: latency,
        }
      );
      return {
        ...msg,
        deviceCommand: {
          command: intentResult.command,
          query: intentResult.query,
          packageName: intentResult.packageName,
          url: intentResult.url
        }
      };
    } else if (
      intentResult.action === "mixed_results" ||
      intentResult.action === "application_pending"
    ) {
      systemPromptExt = `\n\nSystem returned these special results:\n${JSON.stringify(intentResult)}\n\nPlease inform the user.`;
    }

    // 3. Format response using AI
    const aiResponse = await callAI(userId, history, content, systemPromptExt);

    const latency = Date.now() - start;
    const msg = await saveMessage(
      client,
      sessionId,
      userId,
      "assistant",
      aiResponse.text,
      {
        tool_name: toolName,
        model: aiResponse.model,
        provider: aiResponse.provider,
        latency_ms: latency,
      },
    );
    return msg;
  });
}

// ---------------------------------------------------------------------------
// WebSocket streaming
// ---------------------------------------------------------------------------
export async function streamMessage(ws, userId, sessionId, content) {
  const send = (event, data) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ event, ...data }));
  };

  await withTransaction(async (client) => {
    await saveMessage(client, sessionId, userId, "user", content);

    const historyRes = await client.query(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [sessionId],
    );
    const history = historyRes.rows.reverse();
    const start = Date.now();

    // 1. Route Intent
    const mappedHistory = history.map((h) => ({
      role: h.role,
      content: h.content,
    }));
    const intentResult = await routeUserMessage(content, {
      userId,
      history: mappedHistory,
    });

    // 2. Handle MCP tool call logging
    let toolName = null;
    let systemPromptExt = "";
    let providerUsed = "gemini"; // default; overridden to "groq" on Gemini failure

    if (intentResult.tool) {
      toolName = intentResult.tool;
      try {
        await client.query(
          `INSERT INTO mcp_tool_calls (user_id, session_id, tool, input, output, success, latency_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            sessionId,
            toolName,
            intentResult.params || {},
            intentResult.result || {},
            intentResult.success !== false,
            Date.now() - start,
          ],
        );
      } catch (logErr) {
        console.error("❌ Failed to log MCP tool call:", logErr);
      }

      if (intentResult.action !== "respond" && intentResult.action !== "background_task") {
        const dataStr = intentResult.result?.summary || JSON.stringify(intentResult.result || {});
        systemPromptExt = `\n\n[SYSTEM DATA]: You just checked the necessary information for the user. Here is what you found:\n${dataStr.substring(0, 5000)}\n\n[INSTRUCTION]: Respond to the user naturally using this information. You MUST use the EXACT details from the data above if meetings are present. Do NOT invent fake meeting names or projects. Do NOT mention that you checked a database, used a tool, or received JSON. Speak directly as Anya in a conversational, warm tone. If the data says there are no meetings or events, politely tell the user that their schedule is clear!`;
      }
    } else if (intentResult.action === "background_task") {
      // 1. Immediate acknowledgment
      const text = intentResult.response;
      send("chunk", { text });
      const latency = Date.now() - start;
      await saveMessage(client, sessionId, userId, "assistant", text, {
        provider: "system",
        model: "background-handler",
        latency_ms: latency,
        is_streamed: true,
      });
      send("done", { latency_ms: latency, provider: "system" });

      // 2. Detached Execution (Does NOT block the chat!)
      (async () => {
        try {
          const bgStart = Date.now();
          console.log(`⏳ Background task started: ${intentResult.tool}...`);
          const bgResult = await intentResult.execute();

          const poolModule = await import('../db/pool.js');
          const pool = poolModule.default;

          await pool.query(
            `INSERT INTO mcp_tool_calls (user_id, session_id, tool, input, output, success, latency_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              userId,
              sessionId,
              intentResult.tool,
              intentResult.params || {},
              bgResult.result || { error: bgResult.error },
              bgResult.success !== false,
              Date.now() - bgStart,
            ],
          );

          if (bgResult.success === false) {
            throw new Error(bgResult.error || "Unknown tool execution error");
          }

          const bgPrompt = `\n\n[SYSTEM DATA]: The background task '${intentResult.tool}' just finished. Here are the results:\n${JSON.stringify(bgResult.result).substring(0, 5000)}\n\n[INSTRUCTION]: The user is waiting for these results. Present them naturally, warmly, and thoroughly. Do NOT mention that you used a background task, tool, or received JSON. Just say you found the results!`;

          const historyRes2 = await pool.query(
            `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [sessionId],
          );
          const bgHistory = historyRes2.rows.reverse();

          const { text: bgAIResponse, model, provider } = await callAI(userId, bgHistory, "[Background task finished. Summarize results to user]", bgPrompt);


          // Push the final result to the frontend
          send("background_result", { text: bgAIResponse });

          await saveMessage(pool, sessionId, userId, "assistant", bgAIResponse, {
            tool_name: intentResult.tool,
            model,
            provider,
            latency_ms: Date.now() - bgStart,
          });
          console.log(`✅ Background task completed: ${intentResult.tool}`);
        } catch (err) {
          console.error("❌ Background task failed:", err);
          send("background_result", { 
            text: `⚠️ I ran into an issue while running the background task *${intentResult.tool || 'job scan'}*:\n\n*${err.message || String(err)}*\n\nPlease make sure your internet is working or try again later.` 
          });
        }
      })();

      return; // Free the websocket/connection immediately!
    } else if (intentResult.action === "respond" && intentResult.response) {
      // Fast path: Intent router already generated casual chat response!
      const text = intentResult.response;
      send("chunk", { text });
      const latency = Date.now() - start;
      await saveMessage(client, sessionId, userId, "assistant", text, {
        provider: "groq",
        model: "llama-3.1-8b-instant",
        latency_ms: latency,
        is_streamed: true,
      });
      send("done", { latency_ms: latency, provider: "groq" });
      return;
    } else if (intentResult.action === "device_command") {
      const bgPrompt = `\n\n[SYSTEM ACTION]: You are executing a device command. Details:
- Command: ${intentResult.command}
- Song/Query: ${intentResult.query || 'None'}
- Package Name: ${intentResult.packageName || 'None'}
- URL: ${intentResult.url || 'None'}

[INSTRUCTION]: Tell the user in your normal, warm, and friendly voice (as Anya) that you are opening or playing this for them. Keep it natural, under 2 sentences, and sound enthusiastic! Do NOT mention JSON or backend commands.`;

      const aiResponse = await callAI(userId, history, content, bgPrompt);
      const text = aiResponse.text;
      send("chunk", { text });
      const latency = Date.now() - start;
      await saveMessage(client, sessionId, userId, "assistant", text, {
        provider: aiResponse.provider,
        model: aiResponse.model,
        latency_ms: latency,
        is_streamed: true,
      });
      send("device_command", {
        command: intentResult.command,
        query: intentResult.query,
        packageName: intentResult.packageName,
        url: intentResult.url
      });
      send("done", { latency_ms: latency, provider: aiResponse.provider });
      return;
    } else if (
      intentResult.action === "mixed_results" ||
      intentResult.action === "application_pending"
    ) {
      systemPromptExt = `\n\nSystem returned these special results:\n${JSON.stringify(intentResult)}\n\nPlease inform the user.`;
    }

    const systemInstruction = await getAnyaSystemPrompt(userId, systemPromptExt);

    let fullText = ""; // accumulates streamed response from Gemini or Groq fallback

    try {
      // Try Gemini streaming first
      const geminiStart = Date.now();
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: systemInstruction,
      });
      // Build sanitized history — exclude the current user turn (last item),
      // then ensure it starts with 'user' and has strictly alternating roles.
      const geminiHistory = sanitizeGeminiHistory(history.slice(0, -1));
      const chat = model.startChat({ history: geminiHistory });
      const result = await chat.sendMessageStream(content);
      for await (const chunk of result.stream) {
        if (ws.isCancelled || ws.readyState !== 1) {
          console.log(`[chat.service] Gemini stream interrupted for session: ${sessionId}`);
          break;
        }
        const text = chunk.text();
        fullText += text;
        send("chunk", { text });
      }
      // ✅ Track Gemini as healthy
      recordModelHealth("gemini", GEMINI_MODEL, true, Date.now() - geminiStart);
    } catch (geminiErr) {
      if (ws.isCancelled || ws.readyState !== 1) {
        console.log(`[chat.service] Gemini stream was cancelled. Not falling back to Groq.`);
      } else {
        // ❌ Track Gemini failure with reason
        recordModelHealth("gemini", GEMINI_MODEL, false, 0, geminiErr.message);
        console.warn(`[chat] Gemini stream failed (${GEMINI_MODEL}), falling back to Groq:`, geminiErr.message);
        providerUsed = "groq";
        fullText = "";

        const groqStart = Date.now();
        const groqStream = await groq.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: systemInstruction },
            ...history.map((m) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            })),
          ],
          stream: true,
          max_tokens: 1024,
        });
        for await (const chunk of groqStream) {
          if (ws.isCancelled || ws.readyState !== 1) {
            console.log(`[chat.service] Groq stream interrupted for session: ${sessionId}`);
            break;
          }
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) {
            fullText += text;
            send("chunk", { text });
          }
        }
        // ✅ Track Groq as healthy
        recordModelHealth("groq", GROQ_MODEL, true, Date.now() - groqStart);
      }
    }

    const latency = Date.now() - start;
    if (ws.isCancelled) {
      if (!fullText.trim()) {
        console.log(`[chat.service] Stream cancelled before any content was generated. Skipping assistant message save.`);
        return;
      }
      fullText += " [Interrupted]";
    }

    await saveMessage(client, sessionId, userId, "assistant", fullText, {
      tool_name: toolName,
      provider: providerUsed,
      model: providerUsed === "gemini" ? GEMINI_MODEL : GROQ_MODEL,
      latency_ms: latency,
      is_streamed: true,
    });

    if (!ws.isCancelled) {
      send("done", { latency_ms: latency, provider: providerUsed });
    }
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
export async function searchMessages(userId, q, { limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT m.id, m.role, m.content, m.created_at, s.title as session_title, s.id as session_id
     FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id
     WHERE m.user_id = $1
       AND to_tsvector('english', m.content) @@ plainto_tsquery('english', $2)
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [userId, q, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function callAI(userId, history, content, systemPromptExt = "") {
  const systemInstruction = await getAnyaSystemPrompt(userId, systemPromptExt);
  try {
    const geminiStart = Date.now();
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemInstruction,
    });
    const geminiHistory = sanitizeGeminiHistory(history.slice(0, -1));
    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(content);
    recordModelHealth("gemini", GEMINI_MODEL, true, Date.now() - geminiStart);
    return { text: result.response.text(), provider: "gemini", model: GEMINI_MODEL };
  } catch (geminiErr) {
    recordModelHealth("gemini", GEMINI_MODEL, false, 0, geminiErr.message);
    console.warn(`[callAI] Gemini failed (${GEMINI_MODEL}), using Groq:`, geminiErr.message);
    const groqStart = Date.now();
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: ANYA_PERSONA + systemPromptExt },
        ...history.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        { role: "user", content },
      ],
      max_tokens: 1024,
    });
    recordModelHealth("groq", GROQ_MODEL, true, Date.now() - groqStart);
    return {
      text: completion.choices[0].message.content,
      provider: "groq",
      model: GROQ_MODEL,
    };
  }
}
