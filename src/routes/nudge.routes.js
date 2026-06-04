// src/routes/nudge.routes.js
import { Router } from "express";
import * as nc from "../controller/nudge.controller.js";

const router = Router();

import { sendSmartNotification } from '../utils/notificationHelper.js';

router.get("/", nc.listNudges);
router.post("/", nc.recordNudge);
router.patch("/:id/engage", nc.engageNudge);
router.get("/today/count", nc.getTodayCount);
router.get("/categories", nc.getCategories);
router.put("/categories/:name", nc.updateCategory);
router.get("/schedule", nc.getSchedule);
router.put("/schedule/:slot", nc.updateScheduleSlot);

router.post("/test-trigger", async (req, res) => {
  const userId = req.headers['x-user-id'] || '89968338-6678-48e0-be01-f8472e550e1d';
  try {
    const result = await sendSmartNotification({
      type: 'custom',
      userId,
      title: '🚀 Elite Startup Motivation',
      body: 'Pawan, your ultimate goal is clear: land that elite software engineering job, master System Design, and launch your own massive IT startup! Focus today!',
      data: {
        imageUrl: 'https://images.unsplash.com/photo-1618401471353-b98aedd07871?w=300&q=80'
      }
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
