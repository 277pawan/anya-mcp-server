// src/routes/history.routes.js
import { Router } from "express";
import * as hc from "../controller/history.controller.js";

const router = Router();

router.get("/mcp-calls", hc.getMCPHistory);
router.get("/ai-calls", hc.getAIHistory);
router.get("/ai-calls/stats", hc.getAIStats);
router.get("/leads", hc.getLeadHistory);
router.get("/leads/:id", hc.getLeadById);
router.get("/notifications", hc.getNotifications);
router.patch("/notifications/:id/read", hc.markNotificationRead);
router.patch("/notifications/read-all", hc.markAllRead);

export default router;
