// src/controller/nudge.controller.js
import * as NudgeService from '../services/nudge.service.js';

const uid = (req) => req.userId || process.env.DEFAULT_USER_ID;

export async function listNudges(req, res) {
  try {
    const { category, from, to, limit, offset } = req.query;
    const nudges = await NudgeService.listNudges(uid(req), { category, from, to, limit: parseInt(limit||'50'), offset: parseInt(offset||'0') });
    res.json({ success: true, data: nudges, count: nudges.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function recordNudge(req, res) {
  try {
    const { category, theme, slot, message } = req.body;
    if (!category) return res.status(400).json({ error: 'category is required' });
    const nudge = await NudgeService.recordNudge(uid(req), { category, theme, slot, message });
    res.status(201).json({ success: true, data: nudge });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function engageNudge(req, res) {
  try {
    const engaged = req.body.engaged !== false;
    const nudge = await NudgeService.engageNudge(uid(req), req.params.id, engaged);
    if (!nudge) return res.status(404).json({ error: 'Nudge not found' });
    res.json({ success: true, data: nudge });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getTodayCount(req, res) {
  try {
    const count = await NudgeService.getNudgesCountToday(uid(req));
    res.json({ success: true, data: { count } });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getCategories(req, res) {
  try {
    const cats = await NudgeService.getNudgeCategories(uid(req));
    res.json({ success: true, data: cats });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function updateCategory(req, res) {
  try {
    const cat = await NudgeService.updateNudgeCategory(uid(req), req.params.name, req.body);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    res.json({ success: true, data: cat });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function getSchedule(req, res) {
  try {
    const schedule = await NudgeService.getNudgeSchedule(uid(req));
    res.json({ success: true, data: schedule });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

export async function updateScheduleSlot(req, res) {
  try {
    const slot = await NudgeService.updateNudgeScheduleSlot(uid(req), req.params.slot, req.body);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    res.json({ success: true, data: slot });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
