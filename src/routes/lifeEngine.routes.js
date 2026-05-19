// src/routes/lifeEngine.routes.js
import { Router } from 'express';
import * as LE from '../controller/lifeEngine.controller.js';

const router = Router();

router.get('/state',              LE.getState);
router.put('/streak',             LE.updateStreak);
router.post('/streak/increment',  LE.incrementStreak);
router.post('/mood',              LE.logMood);
router.get('/mood/history',       LE.getMoodHistory);
router.get('/stats/weekly',       LE.getWeeklyStats);
router.get('/stats/summary',      LE.getEngagementSummary);

export default router;
