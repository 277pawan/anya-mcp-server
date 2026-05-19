// src/routes/chat.routes.js
import { Router } from "express";
import * as cc from "../controller/chat.controller.js";

const router = Router();

router.post("/session", cc.createSession);
router.get("/sessions", cc.listSessions);
router.get("/session/:id", cc.getSession);
router.delete("/session/:id", cc.deleteSession);
router.post("/message", cc.sendMessage);
router.get("/search", cc.searchMessages);

export default router;
