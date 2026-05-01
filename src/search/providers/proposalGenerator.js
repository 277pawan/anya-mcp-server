import { CONFIG } from "../../config/config.js";
import { chatWithGlobalFallback } from "../../ai/llm-fallback.js";

const PROPOSAL_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
];

export async function generateProposal(lead, userContext, objective = "freelance_pitch") {
    const systemPrompt = `You are an expert copywriter and sales strategist. Your goal is to write a highly converting, personalized cold email. 
Keep it concise, professional, and entirely tailored to the lead. Avoid clichés.
The objective is: ${objective} (e.g., 'job_hunting', 'freelance_pitch', 'b2b_sales').

Rules:
1. Do NOT use fake placeholders like [Your Name], use the provided User Context.
2. Personalize the opening line based on the lead's company or title.
3. Show value immediately. Keep it under 150 words if possible.
4. Add a clear, low-friction Call to Action (CTA).
5. Output ONLY the JSON with the subject line and email body.

Output format:
{
  "subject": "Compelling subject line",
  "body": "The complete email body text"
}
`;

    const userPrompt = `
Lead Information:
Name: ${lead.name || "Hiring Manager / Team"}
Title: ${lead.title || "Relevant Decision Maker"}
Company: ${lead.company}
Reasoning/Context: ${lead.reasoning || lead.snippet}

User Context (Sender):
${JSON.stringify(userContext, null, 2)}

Generate the personalized email.`;

    try {
      const response = await chatWithGlobalFallback({
        taskName: "Proposal generation",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        maxTokens: 320,
        responseFormat: { type: "json_object" },
        groqModels: PROPOSAL_MODELS,
        mistralModels: ["mistral-small-latest"],
        groqApiKey: process.env.GROQ_API_KEY || CONFIG.GROQ_API_KEY,
        mistralApiKey: process.env.MISTRAL_API_KEY || CONFIG.MISTRAL_API_KEY,
      });

      if (!response.success) {
        console.error("Proposal Generator Error:", response.error);
        return { success: false, error: response.error || "Failed to generate proposal" };
      }

      const result = JSON.parse(response.content);
      return {
        success: true,
        subject: result.subject,
        body: result.body,
      };
    } catch (err) {
      console.error("Proposal Generator Error:", err.message);
      return { success: false, error: err.message };
    }
}
