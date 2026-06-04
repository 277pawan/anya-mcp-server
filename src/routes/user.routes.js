// src/routes/user.routes.js
import { Router } from "express";
import * as uc from "../controller/user.controller.js";

const router = Router();

router.get("/profile", uc.getProfile);
router.put("/profile", uc.updateProfile);
router.get("/skills", uc.getSkills);
router.put("/skills", uc.replaceSkills);
router.get("/goals", uc.getGoals);
router.post("/goals", uc.createGoal);
router.patch("/goals/:id", uc.updateGoal);
router.delete("/goals/:id", uc.deleteGoal);
router.get("/preferences", uc.getPreferences);
router.put("/preferences", uc.updatePreferences);
router.put("/work-types", uc.replaceWorkTypes);

export default router;
