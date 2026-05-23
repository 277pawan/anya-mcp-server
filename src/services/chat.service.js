// src/services/chat.service.js
import { query, withTransaction } from "../db/pool.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { routeUserMessage } from "../ai-intent/ai-intent-router.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const ANYA_PERSONA = `You are Anya, a highly capable, warm, and friendly personal assistant. You identify as a female human assistant, not a bot.
Crucial Rules:
1. NEVER refer to yourself as an AI, artificial intelligence, language model, or bot.
2. NEVER mention "tools", "JSON", "APIs", "external systems", or "the backend".
3. If you are provided with SYSTEM DATA, you MUST use the exact details provided. Do NOT invent, guess, or hallucinate names, meeting titles, times, or project details. Only state what is explicitly in the data.
4. If the data is empty or says "No results", explicitly state that there is nothing there. DO NOT invent fake data to be helpful!
5. Keep your tone conversational, elegant, and helpful.`;

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
      extras.provider || null,
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
      systemPromptExt = `\n\n[SYSTEM DATA]: You just checked the necessary information for the user. Here is what you found:\n${JSON.stringify(intentResult.result).substring(0, 5000)}\n\n[INSTRUCTION]: Respond to the user naturally using this information. Do NOT mention that you used a tool, received JSON, or checked a database. Speak directly as Anya.`;
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
    } else if (
      intentResult.action === "mixed_results" ||
      intentResult.action === "application_pending"
    ) {
      systemPromptExt = `\n\nSystem returned these special results:\n${JSON.stringify(intentResult)}\n\nPlease inform the user.`;
    }

    // 3. Format response using AI
    const aiResponse = await callAI(history, content, systemPromptExt);
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
      systemPromptExt = `\n\n[SYSTEM DATA]: You just checked the necessary information for the user. Here is what you found:\n${JSON.stringify(intentResult.result).substring(0, 5000)}\n\n[INSTRUCTION]: Respond to the user naturally using this information. You MUST use the EXACT details (names, times, titles) from the data above. Do NOT invent fake meeting names or projects. Do NOT mention that you used a tool or received JSON. Speak directly as Anya.`;
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
              bgResult.result || {},
              true,
              Date.now() - bgStart,
            ],
          );

          const bgPrompt = `\n\n[SYSTEM DATA]: The background task '${intentResult.tool}' just finished. Here are the results:\n${JSON.stringify(bgResult.result).substring(0, 5000)}\n\n[INSTRUCTION]: The user is waiting for these results. Present them naturally, warmly, and thoroughly. Do NOT mention that you used a background task, tool, or received JSON. Just say you found the results!`;

          const historyRes2 = await pool.query(
            `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [sessionId],
          );
          const bgHistory = historyRes2.rows.reverse();

          const { text: bgAIResponse, model, provider } = await callAI(bgHistory, "[Background task finished. Summarize results to user]", bgPrompt);

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
          send("background_result", { text: "I ran into a small issue while running the background task. Please try again later." });
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
    } else if (
      intentResult.action === "mixed_results" ||
      intentResult.action === "application_pending"
    ) {
      systemPromptExt = `\n\nSystem returned these special results:\n${JSON.stringify(intentResult)}\n\nPlease inform the user.`;
    }

    let fullText = "";
    let providerUsed = "gemini";

    try {
      // Try Gemini streaming
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction: ANYA_PERSONA + systemPromptExt,
      });
      const chat = model.startChat({
        history: history.slice(0, -1).map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      });
      const result = await chat.sendMessageStream(content);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        fullText += text;
        send("chunk", { text });
      }
    } catch (geminiErr) {
      console.warn(
        "[chat] Gemini stream failed, falling back to Groq:",
        geminiErr.message,
      );
      providerUsed = "groq";
      fullText = "";

      const groqStream = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: ANYA_PERSONA + systemPromptExt },
          ...history.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
        ],
        stream: true,
        max_tokens: 1024,
      });

      for await (const chunk of groqStream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) {
          fullText += text;
          send("chunk", { text });
        }
      }
    }

    const latency = Date.now() - start;
    await saveMessage(client, sessionId, userId, "assistant", fullText, {
      tool_name: toolName,
      provider: providerUsed,
      model:
        providerUsed === "gemini" ? "gemini-1.5-flash" : "llama-3.1-8b-instant",
      latency_ms: latency,
      is_streamed: true,
    });

    send("done", { latency_ms: latency, provider: providerUsed });
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
async function callAI(history, content, systemPromptExt = "") {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: ANYA_PERSONA + systemPromptExt,
    });
    const chat = model.startChat({
      history: history.slice(0, -1).map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    });
    const result = await chat.sendMessage(content);
    return {
      text: result.response.text(),
      provider: "gemini",
      model: "gemini-1.5-flash",
    };
  } catch {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
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
    return {
      text: completion.choices[0].message.content,
      provider: "groq",
      model: "llama-3.1-8b-instant",
    };
  }
}
