import { Router } from 'express';
import * as rc from '../controller/report.controller.js';
const router = Router();
router.get('/weekly', rc.getWeeklyReports);
export default router;
