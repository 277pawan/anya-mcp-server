import { CONFIG } from "../config/config.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

function parseRetryDelayMs(errorData) {
  const message = errorData?.error?.message || "";
  const match = message.match(/try again in (\d+)ms/i);
  return match ? Math.max(Number(match[1]), 250) : 1200;
}

function shouldRetry(status, errorData) {
  const code = errorData?.error?.code || "";
  return (
    status === 429 ||
    status === 503 ||
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

export async function chatWithGlobalFallback({
  messages,
  taskName = "LLM task",
  temperature = 0.3,
  maxTokens = 500,
  responseFormat,
  groqModels = [],
  mistralModels = ["mistral-small-latest"],
  groqApiKey = process.env.GROQ_API_KEY || CONFIG.GROQ_API_KEY,
  mistralApiKey = process.env.MISTRAL_API_KEY || CONFIG.MISTRAL_API_KEY,
}) {
  const candidates = [];

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
      candidates.push({
        provider: "mistral",
        apiUrl: MISTRAL_API_URL,
        apiKey: mistralApiKey,
        model,
      });
    }
  }

  if (!candidates.length) {
    return {
      success: false,
      error: "No AI provider key available (GROQ_API_KEY or MISTRAL_API_KEY)",
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
    const errorData = result.data || {};
    lastError = errorData?.error?.message || `${candidate.provider} API ${status}`;
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
