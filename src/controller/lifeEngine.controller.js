// src/controller/lifeEngine.controller.js
import * as LifeService from '../services/lifeEngine.service.js';
import { extractAndSaveInsights } from '../services/chat-cleanup.service.js';
import { query } from '../db/pool.js';

const uid = (req) => req.userId || process.env.DEFAULT_USER_ID;

export async function getState(req, res) {
  try {
    const state = await LifeService.getLifeEngineState(uid(req));
    if (!state) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, data: state });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function updateStreak(req, res) {
  try {
    const result = await LifeService.updateStreak(uid(req), req.body);
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function incrementStreak(req, res) {
  try {
    const result = await LifeService.incrementStreak(uid(req));
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function logMood(req, res) {
  try {
    const { mood, note } = req.body;
    if (!mood || mood < 1 || mood > 10) return res.status(400).json({ error: 'mood must be between 1 and 10' });
    const entry = await LifeService.logMood(uid(req), mood, note);
    res.status(201).json({ success: true, data: entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getMoodHistory(req, res) {
  try {
    const history = await LifeService.getMoodHistory(uid(req), {
      days: parseInt(req.query.days||'30'), limit: parseInt(req.query.limit||'100')
    });
    res.json({ success: true, data: history });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getWeeklyStats(req, res) {
  try {
    const stats = await LifeService.getWeeklyStats(uid(req), req.query.weekStart || null);
    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getEngagementSummary(req, res) {
  try {
    const summary = await LifeService.getEngagementSummary(uid(req));
    res.json({ success: true, data: summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function triggerCleanupAndInsights(req, res) {
  try {
    const userId = uid(req);
    const insights = await extractAndSaveInsights(userId);
    
    const deletedMessages = await query(
      `DELETE FROM chat_messages WHERE user_id = $1 AND created_at < NOW() - INTERVAL '30 days'`,
      [userId]
    );

    const deletedSessions = await query(
      `DELETE FROM chat_sessions 
       WHERE user_id = $1 
         AND (last_message_at < NOW() - INTERVAL '30 days' 
              OR (last_message_at IS NULL AND created_at < NOW() - INTERVAL '30 days'))`,
      [userId]
    );

    res.json({ 
      success: true, 
      message: 'Chat cleanup and insight extraction completed successfully', 
      deletedMessagesCount: deletedMessages.rowCount,
      deletedSessionsCount: deletedSessions.rowCount,
      insights 
    });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
}

