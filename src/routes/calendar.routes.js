// src/routes/calendar.routes.js
import { Router } from "express";
import * as cc from "../controller/calendar.controller.js";

const router = Router();

router.get("/events", cc.listEvents);
router.get("/events/:id", cc.getEvent);
router.post("/events", cc.createEvent);
router.put("/events/:id", cc.updateEvent);
router.delete("/events/:id", cc.deleteEvent);
router.get("/today", cc.getTodayEvents);
router.get("/upcoming", cc.getUpcomingEvents);
router.post("/sync", cc.syncFromGoogle);

export default router;
