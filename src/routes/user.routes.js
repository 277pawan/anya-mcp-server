// src/routes/user.routes.js
import { Router } from "express";
import multer from "multer";
import * as uc from "../controller/user.controller.js";

const router = Router();

// Memory storage — file never touches disk; buffer is piped straight to Cloudinary
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB max

router.post("/resume/upload", upload.single("resume"), uc.uploadResume);

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

