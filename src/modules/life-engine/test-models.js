import dotenv from 'dotenv';
dotenv.config();

const GITHUB_MODELS_API_URL = "https://models.inference.ai.azure.com/chat/completions";

async function testModel(modelName) {
  const response = await fetch(GITHUB_MODELS_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 10
    })
  });
  const data = await response.json();
  if (data.error) {
    console.log(`❌ ${modelName}: ${data.error.code} - ${data.error.message}`);
  } else {
    console.log(`✅ ${modelName}: SUCCESS`);
  }
}

async function run() {
  const modelsToTest = [
    "Phi-3-mini-4k-instruct",
    "Phi-3.5-mini-instruct",
    "Phi-4",
    "gpt-4o-mini",
    "Meta-Llama-3-8B-Instruct"
  ];
  for (const m of modelsToTest) {
    await testModel(m);
  }
}

run();
