// src/routes/user.routes.js
import { Router } from 'express';
import * as UC from '../controller/user.controller.js';

const router = Router();

router.get('/profile',       UC.getProfile);
router.put('/profile',       UC.updateProfile);
router.get('/skills',        UC.getSkills);
router.put('/skills',        UC.replaceSkills);
router.get('/goals',         UC.getGoals);
router.post('/goals',        UC.createGoal);
router.patch('/goals/:id',   UC.updateGoal);
router.delete('/goals/:id',  UC.deleteGoal);
router.get('/preferences',   UC.getPreferences);
router.put('/preferences',   UC.updatePreferences);

export default router;
