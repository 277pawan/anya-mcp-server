import { CONFIG } from "../../config/config.js";
import { chatWithGlobalFallback } from "../../ai/llm-fallback.js";

const PROPOSAL_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
];

export async function generateProposal(lead, userContext, objective = "freelance_pitch") {
    const systemPrompt = `You are an elite executive copywriter and technical recruiter. Your sole objective is to write an ultra-professional, highly compelling cold email that maximizes response rates from hiring managers and decision-makers.
The objective is: ${objective} (e.g., 'job_hunting', 'freelance_pitch', 'b2b_sales').

Rules for Maximum Conversion:
1. Tone: Highly professional, confident, and direct. No fluff, no clichés, no desperation.
2. Structure: 
   - Hook: A customized opening referencing their specific company or the role (show you did your research).
   - Value Proposition: A concise sentence highlighting the candidate's exact, proven skills relevant to the role.
   - Proof/Action: Mentioning attached resume/portfolio and asking a direct, low-friction question to prompt a reply.
3. Length: Keep it tightly under 150 words. Decision-makers skim.
4. NO Placeholders: Do NOT use [Your Name] or [Phone]. Use the exact provided User Context.
5. Output ONLY valid JSON containing 'subject' (punchy and relevant) and 'body'.

Output format:
{
  "subject": "Professional and compelling subject line",
  "body": "The complete ultra-professional email body text"
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
        githubModels: ["gpt-4o-mini"],
        cloudflareModels: ["@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/microsoft/phi-2"],
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
