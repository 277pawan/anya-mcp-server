// src/controller/user.controller.js
import * as UserService from '../services/user.service.js';

const uid = (req) => req.userId || process.env.DEFAULT_USER_ID;

export async function getProfile(req, res) {
  try {
    const user = await UserService.getUserProfile(uid(req));
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateProfile(req, res) {
  try {
    const user = await UserService.updateUserProfile(uid(req), req.body);
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getSkills(req, res) {
  try {
    const skills = await UserService.getSkills(uid(req));
    res.json({ success: true, data: skills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function replaceSkills(req, res) {
  try {
    const { skills } = req.body;
    if (!Array.isArray(skills)) return res.status(400).json({ error: 'skills must be an array of {category, name}' });
    const data = await UserService.replaceSkills(uid(req), skills);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getGoals(req, res) {
  try {
    const goals = await UserService.getGoals(uid(req), req.query.status || null);
    res.json({ success: true, data: goals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createGoal(req, res) {
  try {
    if (!req.body.title) return res.status(400).json({ error: 'title is required' });
    const goal = await UserService.createGoal(uid(req), req.body);
    res.status(201).json({ success: true, data: goal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateGoal(req, res) {
  try {
    const goal = await UserService.updateGoal(uid(req), req.params.id, req.body);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    res.json({ success: true, data: goal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteGoal(req, res) {
  try {
    const deleted = await UserService.deleteGoal(uid(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Goal not found' });
    res.json({ success: true, message: 'Goal deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPreferences(req, res) {
  try {
    const prefs = await UserService.getPreferences(uid(req));
    res.json({ success: true, data: prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updatePreferences(req, res) {
  try {
    const prefs = await UserService.updatePreferences(uid(req), req.body);
    res.json({ success: true, data: prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function replaceWorkTypes(req, res) {
  try {
    const { workTypes } = req.body;
    if (!Array.isArray(workTypes)) return res.status(400).json({ error: 'workTypes must be an array of strings' });
    const data = await UserService.replaceWorkTypes(uid(req), workTypes);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
