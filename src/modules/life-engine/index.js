import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CategorySelector } from "./categorySelector.js";
import { AIGenerator } from "./aiGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_CONTEXT_PATH = path.join(__dirname, "../../dummydata/userContext.json");

/**
 * Anya Life Engine - Main Entry Point
 */
export class LifeEngine {
  
  static async getUserState() {
    try {
      const data = fs.readFileSync(USER_CONTEXT_PATH, "utf-8");
      const context = JSON.parse(data);
      // Ensure lifeEngine object exists
      if (!context.lifeEngine) {
        context.lifeEngine = {
          streak: 0,
          currentMood: null,
          lastNudgeDate: null,
          receivedNudges: [],
          weeklyStats: { health: 0, mind: 0, business: 0, tech: 0, body: 0 }
        };
      }
      return { fullContext: context, state: context.lifeEngine };
    } catch (err) {
      console.error("[Life Engine] Error reading userContext.json:", err);
      throw err;
    }
  }

  static async saveUserState(fullContext) {
    try {
      fs.writeFileSync(USER_CONTEXT_PATH, JSON.stringify(fullContext, null, 2), "utf-8");
    } catch (err) {
      console.error("[Life Engine] Error saving userContext.json:", err);
    }
  }

  /**
   * Triggers the nudge pipeline.
   * In a real app, a cron job or scheduler would call this function periodically.
   */
  static async triggerNudge() {
    console.log(`\n[Life Engine] Starting nudge pipeline...`);

    // 1. Fetch User State from JSON
    const { fullContext, state } = await this.getUserState();

    // 2. Select Category & Type (Layers 1, 2, 3, 6)
    const nudgeSelection = CategorySelector.selectNudge(state);
    console.log(`[Life Engine] Selected: ${nudgeSelection.category} | Phase: ${nudgeSelection.phase} | Type: ${nudgeSelection.type}`);

    // 3. Generate Message (Layers 4, 5, 7)
    // We pass state so it has streak/mood, but AIGenerator currently extracts name from old JS file.
    // Let's pass the parsed name directly from fullContext to make it cleaner,
    // wait AIGenerator reads from the old file directly. Let's fix AIGenerator in a moment or pass it here.
    const message = await AIGenerator.generateMessage(nudgeSelection, state, fullContext.profile?.name);

    // 4. Send Push Notification (Mock Firebase Delivery)
    this.sendPushNotification(fullContext.profile?.name || "User", message, nudgeSelection);

    // 5. Update State & Track Engagement (Layer 3 & 4 Prep)
    state.receivedNudges.push({
      category: nudgeSelection.category,
      timestamp: Date.now(),
      theme: nudgeSelection.type
    });
    
    // Keep only last 10 nudges to prevent infinite growth
    if (state.receivedNudges.length > 10) {
      state.receivedNudges.shift();
    }
    
    // Update weekly stats
    const catLower = nudgeSelection.category.toLowerCase();
    if (state.weeklyStats[catLower] !== undefined) {
      state.weeklyStats[catLower]++;
    }

    fullContext.lifeEngine = state;
    await this.saveUserState(fullContext);

    return {
      success: true,
      message,
      selection: nudgeSelection
    };
  }

  /**
   * Mock push notification sender.
   * Future: Replace with Firebase Cloud Messaging (FCM) integration.
   */
  static sendPushNotification(userName, message, selection) {
    console.log("\n" + "=".repeat(50));
    console.log(`📲 PUSH NOTIFICATION (Firebase Payload Ready)`);
    console.log(`To: ${userName}`);
    console.log(`Title: Anya • ${selection.category}`);
    console.log(`Body: "${message}"`);
    console.log("=".repeat(50) + "\n");
  }

  /**
   * Weekly Intelligence Report Generator (Addition #4)
   * Run this every Sunday to summarize user's week.
   */
  static async generateWeeklyReport() {
    const { state } = await this.getUserState();
    const stats = state.weeklyStats;
    
    const categories = Object.keys(stats);
    let mostEngaged = categories[0];
    let neglected = categories[0];

    categories.forEach(cat => {
      if (stats[cat] > stats[mostEngaged]) mostEngaged = cat;
      if (stats[cat] < stats[neglected]) neglected = cat;
    });

    console.log("\n" + "=".repeat(50));
    console.log(`📊 WEEKLY INTELLIGENCE REPORT`);
    console.log(`Great consistency this week! You're on a ${state.streak}-day streak.`);
    console.log(`Most active category: ${mostEngaged.toUpperCase()}`);
    console.log(`Needs more attention next week: ${neglected.toUpperCase()}`);
    console.log("=".repeat(50) + "\n");
  }
}
