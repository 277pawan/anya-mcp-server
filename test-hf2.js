import fetch from "node-fetch";

const hfToken = process.env.HF_TOKEN;

async function testHF() {
  const apiUrl = "https://api-inference.huggingface.co/models/microsoft/Phi-3-mini-4k-instruct/v1/chat/completions";
  const messages = [
    { role: "system", content: "You are a helpful AI." },
    { role: "user", content: "Hello" }
  ];
  
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "microsoft/Phi-3-mini-4k-instruct",
      messages,
      max_tokens: 200,
    }),
  });

  console.log("Chat completions Status:", response.status);
  const data = await response.text();
  console.log("Data:", data.substring(0, 500));
}

testHF();
