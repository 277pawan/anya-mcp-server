// config.js - Centralized configuration
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env once from root
dotenv.config({ quiet: true });

export const CONFIG = {
  // Google APIs
  GOOGLE_PUBLIC_API_KEY: process.env.GOOGLE_PUBLIC_API_KEY,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  GEOAPIFY_API_KEY: process.env.GEOAPIFY_API_KEY,
  CALENDAR_ID: process.env.CALENDAR_ID,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,

  // AI APIs
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,

  // App Config
  TIMEZONE: "Asia/Kolkata",
  BASE_MAPS_URL: "https://maps.googleapis.com/maps/api",

  EXA_API_KEY: process.env.EXA_API_KEY,
  BRAVE_API_KEY: process.env.BRAVE_API_KEY,
  PROSPEO_API_KEY: process.env.PROSPEO_API_KEY,
  TINYFISH_API_KEY: process.env.TINYFISH_API_KEY,
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  SERP_API_KEY: process.env.SERP_API_KEY,

  // Check if keys are loaded
  isConfigured() {
    return (
      !!this.GOOGLE_PUBLIC_API_KEY &&
      (!!this.GROQ_API_KEY || !!this.MISTRAL_API_KEY)
    );
  },
};
