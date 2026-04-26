// config.js - Centralized configuration
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env once from root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export const CONFIG = {
  // Google APIs
  GOOGLE_PUBLIC_API_KEY: process.env.GOOGLE_PUBLIC_API_KEY,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  CALENDAR_ID: process.env.CALENDAR_ID,

  // AI APIs
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,

  // App Config
  TIMEZONE: "Asia/Kolkata",
  BASE_MAPS_URL: "https://maps.googleapis.com/maps/api",

  // Check if keys are loaded
  isConfigured() {
    return !!this.GOOGLE_PUBLIC_API_KEY && !!this.GROQ_API_KEY;
  },
};
