// src/services/chat.service.js
import { query, withTransaction } from '../db/pool.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function createSession(userId, title) {
  const { rows } = await query(
    `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING *`,
    [userId, title || `Chat ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`]
  );
  return rows[0];
}

export async function listSessions(userId, { limit = 20, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT id, title, message_count, last_message_at, created_at
     FROM chat_sessions WHERE user_id = $1
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

export async function getSession(userId, sessionId) {
  const [sessionResult, messagesResult] = await Promise.all([
    query(`SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]),
    query(
      `SELECT id, role, content, tool_name, model, provider, created_at
       FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 200`,
      [sessionId]
    ),
  ]);
  if (!sessionResult.rows[0]) return null;
  return { ...sessionResult.rows[0], messages: messagesResult.rows };
}

export async function deleteSession(userId, sessionId) {
  const { rowCount } = await query(
    `DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
async function saveMessage(client, sessionId, userId, role, content, extras = {}) {
  const { rows } = await client.query(
    `INSERT INTO chat_messages (session_id, user_id, role, content, tool_name, model, provider, is_streamed, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [sessionId, userId, role, content, extras.tool_name||null, extras.model||null,
     extras.provider||null, extras.is_streamed||false, extras.latency_ms||null]
  );
  await client.query(
    `UPDATE chat_sessions SET message_count = message_count + 1, last_message_at = now(), updated_at = now()
     WHERE id = $1`, [sessionId]
  );
  return rows[0];
}

export async function sendMessage(userId, sessionId, content) {
  return withTransaction(async (client) => {
    await saveMessage(client, sessionId, userId, 'user', content);
    const historyRes = await client.query(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [sessionId]
    );
    const history = historyRes.rows.reverse();
    const start = Date.now();
    const aiResponse = await callAI(history, content);
    const latency = Date.now() - start;
    const msg = await saveMessage(client, sessionId, userId, 'assistant', aiResponse.text, {
      model: aiResponse.model, provider: aiResponse.provider, latency_ms: latency
    });
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
    await saveMessage(client, sessionId, userId, 'user', content);

    const historyRes = await client.query(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [sessionId]
    );
    const history = historyRes.rows.reverse();

    const start = Date.now();
    let fullText = '';
    let providerUsed = 'gemini';

    try {
      // Try Gemini streaming
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const chat  = model.startChat({
        history: history.slice(0, -1).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      });
      const result = await chat.sendMessageStream(content);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        fullText += text;
        send('chunk', { text });
      }
    } catch (geminiErr) {
      console.warn('[chat] Gemini stream failed, falling back to Groq:', geminiErr.message);
      providerUsed = 'groq';
      fullText = '';

      const groqStream = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You are Anya, a smart personal AI assistant.' },
          ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
        ],
        stream: true,
        max_tokens: 1024,
      });

      for await (const chunk of groqStream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) { fullText += text; send('chunk', { text }); }
      }
    }

    const latency = Date.now() - start;
    await saveMessage(client, sessionId, userId, 'assistant', fullText, {
      provider: providerUsed,
      model:    providerUsed === 'gemini' ? 'gemini-1.5-flash' : 'llama-3.1-8b-instant',
      latency_ms: latency,
      is_streamed: true,
    });

    send('done', { latency_ms: latency, provider: providerUsed });
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
    [userId, q, limit]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function callAI(history, content) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const chat  = model.startChat({
      history: history.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    });
    const result = await chat.sendMessage(content);
    return { text: result.response.text(), provider: 'gemini', model: 'gemini-1.5-flash' };
  } catch {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: 'You are Anya, a smart personal AI assistant.' },
        ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        { role: 'user', content },
      ],
      max_tokens: 1024,
    });
    return {
      text: completion.choices[0].message.content,
      provider: 'groq', model: 'llama-3.1-8b-instant',
    };
  }
}
