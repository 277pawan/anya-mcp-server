import { chatWithGlobalFallback } from "../../ai/llm-fallback.js";

export class AIGenerator {
  static async generateMessage(nudgeSelection, userState, userName = "there") {
    const { category, phase, type } = nudgeSelection;
    const streak = userState.streak || 0;
    const mood = userState.currentMood;

    let systemPrompt = `You are Anya, a highly intelligent, personal life-engine and assistant for ${userName}.
Your goal is to send a single, powerful, short push notification (under 200 characters unless it's a rabbit hole).
Your voice is personal, sometimes direct, sometimes poetic, always insightful. You know ${userName} is trying to grow.
Do not use generic AI speak. No hashtags. Feel like a message from a brilliant mentor.`;

    let userPrompt = `Generate a push notification for ${userName}.
Context:
- Time of day: ${phase}
- Category: ${category}
- Nudge Type: ${type}
- Current Streak: ${streak} days
- User's reported mood (1-5, where 1 is low energy, 5 is high): ${mood || "Unknown"}

Instructions based on type:`;

    if (type === "big_question") {
      userPrompt += `\nThis is the 'One Big Question' of the day. Ask a profound, thought-provoking question that will sit with them all day. Focus on ${category}.`;
    } else if (type === "rabbit_hole") {
      systemPrompt += `\nFor 'rabbit_hole' messages, you can be up to 400 characters. Give a mini 3-point insight or a deep mental model.`;
      userPrompt += `\nThis is a 'Rabbit Hole' deep dive. Share a fascinating insight, mental model, or biological fact related to ${category}. Make it highly engaging.`;
    } else if (type === "streak_nudge") {
      userPrompt += `\nAcknowledge their consistency. This is day ${streak} of them showing up. Frame their consistency as becoming their identity.`;
    } else {
      if (mood && mood <= 2) {
        userPrompt += `\nThe user is having a low energy day. Be gentle but motivating. Focus on micro-actions in ${category}.`;
      } else if (mood && mood >= 4) {
        userPrompt += `\nThe user is high energy today! Push them harder, send bigger ideas or challenges in ${category}.`;
      } else {
        userPrompt += `\nProvide a sharp, useful micro-intervention for ${category}.`;
      }
    }

    userPrompt += `\n\nOutput ONLY the message text. No quotes around it, no extra conversational text.`;

    console.log(`[Anya AI] Requesting generation for: ${category} | Type: ${type}`);

    try {
      const result = await chatWithGlobalFallback({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        taskName: "Anya Life Engine Generation",
        temperature: 0.7,
        maxTokens: type === "rabbit_hole" ? 150 : 60
      });

      if (result.success && result.content) {
        return result.content.trim();
      } else {
        console.warn("[Anya AI] Fallback failed, returning default message.", result.error);
        return this.getDefaultMessage(category, type);
      }
    } catch (error) {
      console.error("[Anya AI] Error generating message:", error);
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
