import { chatWithGlobalFallback } from "../../ai/llm-fallback.js";

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

    let lifeContext = userState.life_context || userState.preferences?.life_context;
    if (lifeContext) {
      const struggles = Array.isArray(lifeContext.struggles) ? lifeContext.struggles.join(', ') : (lifeContext.struggles || 'None');
      const focusGoals = Array.isArray(lifeContext.focusGoals) ? lifeContext.focusGoals.join(', ') : (lifeContext.focusGoals || 'None');
      userPrompt += `\n- User's recent focus/goals: ${focusGoals}\n- User's recent struggles: ${struggles}`;
      systemPrompt += `\nTailor the motivation and advice specifically to help them overcome their struggles or achieve their goals, without explicitly referencing that you are reading this from a list. Make the nudge extremely relevant and deeply empathetic to their situation.`;
    }

    if (type === "big_question") {
      userPrompt += `\nThis is the 'One Big Question' of the day. Ask a profound, thought-provoking question that will sit with them all day. Focus on ${category}.`;
    } else if (type === "rabbit_hole") {
      systemPrompt = `You are Anya, a personal AI for ${userName}. Generate a short rabbit-hole insight (max 3 sentences) for category: ${category}.`;
      userPrompt += `\nThis is a 'Rabbit Hole' deep dive. Share a fascinating insight, mental model, or biological fact related to ${category}.`;
    } else if (type === "streak_nudge") {
      userPrompt += `\nAcknowledge their consistency. Frame their consistency as becoming their identity.`;
    }

    userPrompt += `\n\nOutput ONLY the message text.`;

    console.log(`[Anya AI] Requesting generation for: ${category} | Type: ${type}`);

    try {
      const result = await chatWithGlobalFallback({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        taskName: "Anya Life Engine Generation",
        temperature: 0.7,
        maxTokens: type === "rabbit_hole" ? 150 : 80,
        // specifically request Phi models first
        githubModels: ["Phi-4", "gpt-4o-mini"],
        cloudflareModels: ["@cf/microsoft/phi-2"],
        groqModels: ["llama-3.1-8b-instant"],
        mistralModels: ["mistral-small-latest"],
        geminiModels: ["gemini-1.5-flash", "gemini-2.0-flash"]
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
