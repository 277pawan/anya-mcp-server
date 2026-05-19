// src/routes/history.routes.js
import { Router } from 'express';
import * as HC from '../controller/history.controller.js';

const router = Router();

router.get('/mcp-calls',                   HC.getMCPHistory);
router.get('/ai-calls',                    HC.getAIHistory);
router.get('/ai-calls/stats',              HC.getAIStats);
router.get('/leads',                       HC.getLeadHistory);
router.get('/leads/:id',                   HC.getLeadById);
router.get('/notifications',               HC.getNotifications);
router.patch('/notifications/:id/read',    HC.markNotificationRead);
router.patch('/notifications/read-all',    HC.markAllRead);

export default router;
