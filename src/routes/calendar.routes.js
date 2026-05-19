// src/routes/calendar.routes.js
import { Router } from 'express';
import * as CC from '../controller/calendar.controller.js';

const router = Router();

router.get('/events',        CC.listEvents);
router.get('/events/:id',    CC.getEvent);
router.post('/events',       CC.createEvent);
router.put('/events/:id',    CC.updateEvent);
router.delete('/events/:id', CC.deleteEvent);
router.get('/today',         CC.getTodayEvents);
router.get('/upcoming',      CC.getUpcomingEvents);
router.post('/sync',         CC.syncFromGoogle);

export default router;
