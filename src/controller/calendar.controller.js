// src/controller/calendar.controller.js
import * as CalService from '../services/calendar.service.js';

const uid = (req) => req.userId || process.env.DEFAULT_USER_ID;

export async function listEvents(req, res) {
  try {
    const { from, to, search, limit, offset } = req.query;
    const events = await CalService.listCalendarEvents(uid(req), { from, to, search, limit: parseInt(limit||'50'), offset: parseInt(offset||'0') });
    res.json({ success: true, data: events, count: events.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getEvent(req, res) {
  try {
    const event = await CalService.getCalendarEventById(uid(req), req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true, data: event });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function createEvent(req, res) {
  try {
    const { title, start_time, end_time } = req.body;
    if (!title || !start_time || !end_time) return res.status(400).json({ error: 'title, start_time, end_time required' });
    const event = await CalService.upsertCalendarEvent(uid(req), req.body);
    res.status(201).json({ success: true, data: event });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function updateEvent(req, res) {
  try {
    const event = await CalService.upsertCalendarEvent(uid(req), { ...req.body, id: req.params.id });
    res.json({ success: true, data: event });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function deleteEvent(req, res) {
  try {
    const deleted = await CalService.deleteCalendarEvent(uid(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true, message: 'Event cancelled' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getTodayEvents(req, res) {
  try {
    await CalService.syncTodayFromGoogle(uid(req)).catch(e => console.warn('Google sync skipped:', e.message));
    const events = await CalService.getTodayEvents(uid(req));
    res.json({ success: true, data: events, count: events.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getUpcomingEvents(req, res) {
  try {
    const events = await CalService.getUpcomingEvents(uid(req), parseInt(req.query.days||'7'));
    res.json({ success: true, data: events, count: events.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function syncFromGoogle(req, res) {
  try {
    const events = await CalService.syncTodayFromGoogle(uid(req));
    res.json({ success: true, message: `Synced ${events.length} events`, data: events });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
