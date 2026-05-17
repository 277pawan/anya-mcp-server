import { CONFIG } from "../../config/config.js";

export class AIGenerator {
  static async generateMessage(nudgeSelection, userState, userName = "there") {
    const { category, phase, type } = nudgeSelection;
    const streak = userState.streak || 0;
    const mood = userState.currentMood;

    let systemPrompt = `You are Anya, a personal AI for ${userName}. 
    Generate a short powerful nudge for category: ${category}.
    Be direct, bold, personal. Max 2 sentences.
    Do not use hashtags. Feel like a message from a brilliant mentor.`;

    let userPrompt = `Generate a ${category} nudge for right now.
Context:
- Time of day: ${phase}
- Nudge Type: ${type}
- Current Streak: ${streak} days
- User's reported mood (1-5): ${mood || "Unknown"}`;

    if (type === "big_question") {
      userPrompt += `\nThis is the 'One Big Question' of the day. Ask a profound, thought-provoking question that will sit with them all day. Focus on ${category}.`;
    } else if (type === "rabbit_hole") {
      systemPrompt = `You are Anya, a personal AI for ${userName}. Generate a short rabbit-hole insight (max 3 sentences) for category: ${category}.`;
      userPrompt += `\nThis is a 'Rabbit Hole' deep dive. Share a fascinating insight, mental model, or biological fact related to ${category}.`;
    } else if (type === "streak_nudge") {
      userPrompt += `\nAcknowledge their consistency. Frame their consistency as becoming their identity.`;
    }

    userPrompt += `\n\nOutput ONLY the message text.`;

    console.log(`[Anya AI] Requesting DeepSeek generation for: ${category} | Type: ${type}`);

    try {
      const apiKey = CONFIG.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: type === "rabbit_hole" ? 150 : 80
        })
      });

      const data = await response.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content.trim();
      } else {
        console.warn("[Anya AI] DeepSeek failed, returning default message.", data);
        return this.getDefaultMessage(category, type);
      }
    } catch (error) {
      console.error("[Anya AI] Error generating message with DeepSeek:", error);
      return this.getDefaultMessage(category, type);
    }
  }

  static getDefaultMessage(category, type) {
    if (type === "big_question") return `What would you do today if you knew you couldn't fail?`;
    if (type === "streak_nudge") return `Your consistency is becoming your identity. Keep going.`;
    
    const defaults = {
      Health: "Drink a glass of water right now. Your brain needs it.",
      Mind: "Take a deep breath. Reset your focus.",
      Business: "What is the highest leverage task you can do in the next hour?",
      Tech: "Are you consuming or creating right now?",
      Body: "Check your posture. Shoulders back, breathe."
    };
    return defaults[category] || "Take a moment for yourself.";
  }
}
