// llm-fallback.js
import { CONFIG } from "../config/config.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

function parseRetryDelayMs(errorData) {
  const message = (typeof errorData?.error === 'string' ? errorData.error : errorData?.error?.message) || "";
  const match = message.match(/try again in (\d+)ms/i);
  if (match) return Math.max(Number(match[1]), 250);
  if (errorData?.estimated_time) return Math.max(errorData.estimated_time * 1000, 1000);
  return 1200;
}

function shouldRetry(status, errorData) {
  const code = errorData?.error?.code || "";
  const message = (typeof errorData?.error === 'string' ? errorData.error : errorData?.error?.message) || "";
  return (
    status === 429 ||
    status === 503 ||
    message.includes("is currently loading") ||
    code === "model_decommissioned" ||
    code === "model_not_found" ||
    code === "rate_limit_exceeded" ||
    code === "json_validate_failed"
  );
}

async function callOpenAICompatibleChat({
  apiUrl,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  responseFormat,
}) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      data,
    };
  }

  return {
    success: true,
    content: data?.choices?.[0]?.message?.content || "",
    usage: data?.usage,
  };
}

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const GITHUB_MODELS_API_URL = "https://models.inference.ai.azure.com/chat/completions";

export async function chatWithGlobalFallback({
  messages,
  taskName = "LLM task",
  temperature = 0.3,
  maxTokens = 500,
  responseFormat,
  githubModels = [],
  cloudflareModels = [],
  groqModels = [],
  mistralModels = ["mistral-small-latest"],
  geminiModels = [],
  openrouterModels = [], // NEW
  githubToken = process.env.GITHUB_TOKEN || CONFIG.GITHUB_TOKEN,
  cfAccountId = process.env.CF_ACCOUNT_ID || CONFIG.CF_ACCOUNT_ID,
  cfApiToken = process.env.CF_API_TOKEN || CONFIG.CF_API_TOKEN,
  groqApiKey = process.env.GROQ_API_KEY || CONFIG.GROQ_API_KEY,
  mistralApiKey = process.env.MISTRAL_API_KEY || CONFIG.MISTRAL_API_KEY,
  geminiApiKey = process.env.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY,
  openrouterApiKey = process.env.OPENROUTER_API_KEY || CONFIG.OPENROUTER_API_KEY, // NEW
}) {
  const candidates = [];

  // Add GitHub Models candidates first (replaces Hugging Face effectively)
  if (githubToken && githubModels.length) {
    for (const model of githubModels) {
      candidates.push({
        provider: "github",
        apiUrl: GITHUB_MODELS_API_URL,
        apiKey: githubToken,
        model,
      });
    }
  }

  // Add Cloudflare candidates
  if (cfAccountId && cfApiToken && cloudflareModels.length) {
    for (const model of cloudflareModels) {
      candidates.push({
        provider: "cloudflare",
        apiUrl: `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/v1/chat/completions`,
        apiKey: cfApiToken,
        model, // e.g. "@cf/microsoft/phi-2"
      });
    }
  }

  // Add OpenRouter candidates first if provided (for free models)
  if (openrouterApiKey && openrouterModels.length) {
    for (const model of openrouterModels) {
      candidates.push({
        provider: "openrouter",
        apiUrl: OPENROUTER_API_URL,
        apiKey: openrouterApiKey,
        model,
      });
    }
  }

  // Add Gemini candidates
  if (geminiApiKey && geminiModels.length) {
    for (const model of geminiModels) {
      candidates.push({
        provider: "gemini",
        apiUrl: GEMINI_API_URL,
        apiKey: geminiApiKey,
        model,
      });
    }
  }

  if (groqApiKey && groqModels.length) {
    for (const model of groqModels) {
      candidates.push({
        provider: "groq",
        apiUrl: GROQ_API_URL,
        apiKey: groqApiKey,
        model,
      });
    }
  }

  if (mistralApiKey && mistralModels.length) {
    for (const model of mistralModels) {
      // Check if the key is actually an openrouter key (sk-or-v1) and reroute
      const apiUrl = mistralApiKey.startsWith("sk-or-v1") ? OPENROUTER_API_URL : MISTRAL_API_URL;
      const actualModel = mistralApiKey.startsWith("sk-or-v1") && !model.includes("/") ? `mistralai/${model}` : model;
      candidates.push({
        provider: mistralApiKey.startsWith("sk-or-v1") ? "openrouter" : "mistral",
        apiUrl,
        apiKey: mistralApiKey,
        model: actualModel,
      });
    }
  }

  if (!candidates.length) {
    return {
      success: false,
      error:
        "No AI provider key available (GEMINI_API_KEY, GROQ_API_KEY or MISTRAL_API_KEY)",
    };
  }

  let lastError = "Unknown AI provider error";

  for (const candidate of candidates) {
    const result = await callOpenAICompatibleChat({
      apiUrl: candidate.apiUrl,
      apiKey: candidate.apiKey,
      model: candidate.model,
      messages,
      temperature,
      maxTokens,
      responseFormat,
    });

    if (result.success) {
      return {
        success: true,
        content: result.content,
        usage: result.usage,
        provider: candidate.provider,
        model: candidate.model,
      };
    }

    const status = result.status;
    let errorData = result.data || {};
    if (Array.isArray(errorData)) errorData = errorData[0] || {};
    const errorMsg = typeof errorData?.error === 'string' ? errorData.error : errorData?.error?.message;
    lastError =
      errorMsg || `${candidate.provider} API ${status}`;
    const errorCode = errorData?.error?.code || "unknown_error";

    if (shouldRetry(status, errorData)) {
      const retryMs = parseRetryDelayMs(errorData);
      console.warn(
        `⏳ ${taskName}: ${candidate.provider}/${candidate.model} failed (${errorCode}). Trying next model in ${retryMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      continue;
    }

    console.warn(
      `⚠️ ${taskName}: ${candidate.provider}/${candidate.model} failed (${errorCode}). Trying next provider/model...`,
    );
  }

  return { success: false, error: lastError };
}
