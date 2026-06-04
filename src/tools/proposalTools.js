// src/tools/proposalTools.js
import { findLeadsForProposal } from "../search/leadPipeline.js";
import {
  DEFAULT_LEAD_FETCH_LIMIT,
  DEFAULT_MAX_LEADS,
} from "../search/leadPipelineDefaults.js";
import { chatWithGlobalFallback } from "../ai/llm-fallback.js";

server.tool(
  "findProposalLeads",
  "Find qualified leads for sending proposals or job applications",
  {
    targetQuery: z
      .string()
      .describe(
        "What you're looking for e.g., 'companies hiring MERN stack developers'",
      ),
    maxLeads: z.number().optional().default(DEFAULT_MAX_LEADS),
    fetchLimit: z
      .number()
      .optional()
      .describe(
        `How many URLs to search and scrape (default ${DEFAULT_LEAD_FETCH_LIMIT}; later from user settings DB)`,
      ),
    minRelevanceScore: z.number().optional().default(70),
    includeContactInfo: z.boolean().optional().default(true),
  },
  async ({
    targetQuery,
    maxLeads,
    fetchLimit,
    minRelevanceScore,
    includeContactInfo,
  }) => {
    const result = await findLeadsForProposal(targetQuery, {
      maxLeads,
      fetchLimit,
      minScore: minRelevanceScore,
      includeContactInfo,
    });

    if (!result.success) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: result.error }) },
        ],
      };
    }

    // Generate a summary report
    const report = {
      summary: {
        query: result.query,
        leadsFound: result.totalLeadsFound,
        qualifiedLeads: result.leads.length,
        proposalReadyCount: result.leads.filter((l) => l.proposalReady).length,
      },
      leads: result.leads,
      nextSteps: [
        "Review each lead's relevance score",
        "Click source URLs to verify context",
        "Use found emails to send personalized proposals",
        "Track responses in your CRM",
      ],
    };

    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  },
);

server.tool(
  "generateProposal",
  "Generate a personalized proposal for a qualified lead",
  {
    leadName: z.string().describe("Name of the lead"),
    company: z.string().describe("Company name"),
    context: z
      .string()
      .describe("What they're looking for from the qualified data"),
    yourService: z.string().describe("What you're offering"),
    yourName: z.string().describe("Your name"),
    yourEmail: z.string().describe("Your email for them to reply"),
  },
  async ({ leadName, company, context, yourService, yourName, yourEmail }) => {
    const systemPrompt = `You are a professional proposal writer. Create a concise, personalized proposal.`;

    const response = await chatWithGlobalFallback({
      taskName: "proposalTools.generateProposal",
      groqModels: ["llama-3.1-8b-instant", "qwen/qwen3-32b"],
      mistralModels: ["mistral-small-latest"],
      temperature: 0.7,
      maxTokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `
Write a short proposal for:
- To: ${leadName} at ${company}
- Context: ${context}
- My Service: ${yourService}
- From: ${yourName} (${yourEmail})

Make it:
1. Personalized based on their needs
2. Brief (max 200 words)
3. Include a clear call to action
4. Professional but friendly tone
`,
        },
      ],
    });

    const proposal = response.success
      ? response.content
      : "I am interested in helping with this project and would love to discuss next steps.";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              lead: { name: leadName, company },
              proposal: proposal,
              subjectLine: `Proposal for ${company} - ${yourService}`,
              suggestedNextAction: `Send to ${leadName} at ${leadName.toLowerCase().replace(" ", ".")}@${company.toLowerCase().replace(/\\s/g, "")}.com`,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);
