// src/routes/nudge.routes.js
import { Router } from "express";
import * as nc from "../controller/nudge.controller.js";

const router = Router();

router.get("/", nc.listNudges);
router.post("/", nc.recordNudge);
router.patch("/:id/engage", nc.engageNudge);
router.get("/today/count", nc.getTodayCount);
router.get("/categories", nc.getCategories);
router.put("/categories/:name", nc.updateCategory);
router.get("/schedule", nc.getSchedule);
router.put("/schedule/:slot", nc.updateScheduleSlot);

export default router;
