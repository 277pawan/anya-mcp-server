// src/routes/nudge.routes.js
import { Router } from 'express';
import * as NC from '../controller/nudge.controller.js';

const router = Router();

router.get('/',                  NC.listNudges);
router.post('/',                 NC.recordNudge);
router.patch('/:id/engage',      NC.engageNudge);
router.get('/today/count',       NC.getTodayCount);
router.get('/categories',        NC.getCategories);
router.put('/categories/:name',  NC.updateCategory);
router.get('/schedule',          NC.getSchedule);
router.put('/schedule/:slot',    NC.updateScheduleSlot);

export default router;
