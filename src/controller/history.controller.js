// src/controller/history.controller.js
import * as HistoryService from '../services/history.service.js';

const uid = (req) => req.userId || process.env.DEFAULT_USER_ID;

export async function getMCPHistory(req, res) {
  try {
    const { tool, from, limit, offset } = req.query;
    const data = await HistoryService.getMCPCallHistory(uid(req), { tool, from, limit: parseInt(limit||'50'), offset: parseInt(offset||'0') });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getAIHistory(req, res) {
  try {
    const { provider, from, limit, offset } = req.query;
    const data = await HistoryService.getAICallHistory(uid(req), { provider, from, limit: parseInt(limit||'50'), offset: parseInt(offset||'0') });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getAIStats(req, res) {
  try {
    const stats = await HistoryService.getAICallStats(uid(req));
    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getLeadHistory(req, res) {
  try {
    const data = await HistoryService.getLeadSearchHistory(uid(req), { limit: parseInt(req.query.limit||'30'), offset: parseInt(req.query.offset||'0') });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getLeadById(req, res) {
  try {
    const data = await HistoryService.getLeadSearchById(uid(req), req.params.id);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getNotifications(req, res) {
  try {
    const { unread, type, limit, offset } = req.query;
    const data = await HistoryService.getNotificationHistory(uid(req), { unread: unread === 'true' ? true : undefined, type, limit: parseInt(limit||'50'), offset: parseInt(offset||'0') });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function markNotificationRead(req, res) {
  try {
    const notif = await HistoryService.markNotificationRead(uid(req), req.params.id);
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true, data: notif });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function markAllRead(req, res) {
  try {
    const result = await HistoryService.markAllNotificationsRead(uid(req));
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
