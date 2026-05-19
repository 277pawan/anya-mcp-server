// src/routes/lifeEngine.routes.js
import { Router } from "express";
import * as le from "../controller/lifeEngine.controller.js";

const router = Router();

router.get("/state", le.getState);
router.put("/streak", le.updateStreak);
router.post("/streak/increment", le.incrementStreak);
router.post("/mood", le.logMood);
router.get("/mood/history", le.getMoodHistory);
router.get("/stats/weekly", le.getWeeklyStats);
router.get("/stats/summary", le.getEngagementSummary);

export default router;
