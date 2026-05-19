// src/routes/chat.routes.js
import { Router } from 'express';
import * as CC from '../controller/chat.controller.js';

const router = Router();

router.post('/session',       CC.createSession);
router.get('/sessions',       CC.listSessions);
router.get('/session/:id',    CC.getSession);
router.delete('/session/:id', CC.deleteSession);
router.post('/message',       CC.sendMessage);
router.get('/search',         CC.searchMessages);

export default router;
