// src/services/chat-cleanup.service.js
import { query } from '../db/pool.js';
import { chatWithGlobalFallback } from '../ai/llm-fallback.js';
import { updatePreferences } from './user.service.js';
import { sendSmartNotification } from '../utils/notificationHelper.js';

/**
 * Extracts personal development insights (struggles, goals, mood) from the user's recent chat history
 * and saves them to the user's database preferences under `life_context`.
 * 
 * @param {string} userId - The unique UUID of the user.
 * @returns {Promise<object|null>} The parsed insights object, or null if no chats were found.
 */
export async function extractAndSaveInsights(userId) {
  try {
    // Fetch last 100 messages from the last 30 days
    const msgsRes = await query(
      `SELECT role, content, created_at 
       FROM chat_messages 
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at ASC 
       LIMIT 100`,
      [userId]
    );

    if (msgsRes.rows.length === 0) {
      console.log(`[Chat Insights] No recent chat messages found for user ${userId}. Skipping insight extraction.`);
      return null;
    }

    console.log(`[Chat Insights] Found ${msgsRes.rows.length} messages in the last 30 days for user ${userId}. Extracting insights...`);

    const chatLog = msgsRes.rows
      .map(r => `${r.role === 'user' ? 'User' : 'Anya'}: ${r.content}`)
      .join('\n');

    const prompt = `
You are a brilliant life coach and personal development analyzer. Below is a log of recent chat messages between a user and their personal AI companion, Anya.
Analyze this conversation log to extract a high-quality, actionable summary of the user's current situation, focus, struggles, and general emotional state to help Anya motivate them better in future interactions.

Recent Conversations:
${chatLog}

Please output a JSON object with the following fields:
{
  "struggles": ["list of current struggles/obstacles, e.g. procrastination, feeling tired, coding challenges"],
  "focusGoals": ["what the user is currently working on or focused on"],
  "emotionalState": "a brief description of the user's general mood/feelings recently (e.g. anxious, motivated, overwhelmed)",
  "motivationStrategy": "advice for Anya on how to best motivate the user right now (e.g. gentle encouragement, tough love, step-by-step guidance)"
}

Return ONLY the JSON object. Do not include markdown formatting, backticks, or any conversational preamble/postamble.
`;

    const result = await chatWithGlobalFallback({
      messages: [
        { role: "system", content: "You are a professional personal development analyzer. Analyze chat logs and return insights strictly as a JSON object." },
        { role: "user", content: prompt }
      ],
      taskName: "Anya Life Context Extraction",
      temperature: 0.2,
      maxTokens: 500,
      githubModels: ["gpt-4o-mini", "Phi-4"],
      groqModels: ["llama-3.1-8b-instant"],
      mistralModels: ["mistral-small-latest"]
    });

    if (result.success && result.content) {
      let text = result.content.trim();
      if (text.startsWith("```json")) {
        text = text.substring(7);
      }
      if (text.startsWith("```")) {
        text = text.substring(3);
      }
      if (text.endsWith("```")) {
        text = text.substring(0, text.length - 3);
      }

      try {
        const parsedContext = JSON.parse(text.trim());
        await updatePreferences(userId, { life_context: parsedContext });
        console.log(`[Chat Insights] Successfully saved life_context for user: ${userId}`);

        // Notify user of newly processed insights
        await sendSmartNotification({
          type: 'life_insight',
          userId,
          title: '🧠 Anya Life Update',
          body: `I've analyzed our recent chats. You seem to be feeling ${parsedContext.emotionalState || 'focused'}. Let's keep making progress!`,
          data: {
            emotional_state: parsedContext.emotionalState || 'unknown',
            primary_struggle: parsedContext.struggles?.[0] || 'none'
          }
        });

        return parsedContext;
      } catch (e) {
        console.error("[Chat Insights] Failed to parse LLM insight JSON, saving raw content:", e);
        const rawContext = { 
          struggles: [text.substring(0, 500)], 
          focusGoals: [], 
          emotionalState: "unknown", 
          motivationStrategy: "Warm encouragement" 
        };
        await updatePreferences(userId, { life_context: rawContext });

        await sendSmartNotification({
          type: 'life_insight',
          userId,
          title: '🧠 Anya Life Update',
          body: `I've completed my periodic chat cleanup. Head to settings to view your updated motivation strategy!`,
        });

        return rawContext;
      }
    }
  } catch (err) {
    console.error(`[Chat Insights Error] Failed to extract insights for user ${userId}:`, err);
  }
  return null;
}

/**
 * Runs a global chat history cleanup and extracts life context insights for all users.
 * Deletes chat messages and sessions older than 30 days.
 */
export async function runGlobalChatCleanup() {
  console.log('🧹 [Chat Cleanup] Starting global chat cleanup and insight extraction...');
  try {
    // Get all unique users
    const usersRes = await query('SELECT id, name FROM users');
    for (const userRow of usersRes.rows) {
      const userId = userRow.id;
      const userName = userRow.name;
      console.log(`🧹 [Chat Cleanup] Processing user: ${userName} (${userId})`);
      
      // 1. Extract and save insights to life_context first
      await extractAndSaveInsights(userId);
      
      // 2. Delete messages older than 30 days
      const deletedMessages = await query(
        `DELETE FROM chat_messages WHERE user_id = $1 AND created_at < NOW() - INTERVAL '30 days'`,
        [userId]
      );
      console.log(`[Chat Cleanup] Deleted ${deletedMessages.rowCount} messages older than 30 days for user ${userName}`);

      // 3. Delete empty sessions or sessions with last message older than 30 days
      const deletedSessions = await query(
        `DELETE FROM chat_sessions 
         WHERE user_id = $1 
           AND (last_message_at < NOW() - INTERVAL '30 days' 
                OR (last_message_at IS NULL AND created_at < NOW() - INTERVAL '30 days'))`,
        [userId]
      );
      console.log(`[Chat Cleanup] Deleted ${deletedSessions.rowCount} chat sessions older than 30 days for user ${userName}`);
    }
    console.log('🧹 [Chat Cleanup] Global chat cleanup and insight extraction complete.');
  } catch (err) {
    console.error('🧹 [Chat Cleanup Error] Failed to run global chat cleanup:', err);
  }
}
