import dotenv from "dotenv";
dotenv.config();

const hfToken = process.env.HF_TOKEN;
console.log("HF_TOKEN exists:", !!hfToken);

async function testHF() {
  const apiUrl = "https://api-inference.huggingface.co/models/microsoft/Phi-3-mini-4k-instruct";
  const inputs = "<|system|>\nYou are a helpful AI.<|end|>\n<|user|>\nHello<|end|>\n<|assistant|>\n";
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs,
      parameters: { 
        max_new_tokens: 200,
        temperature: 0.1,
        return_full_text: false 
      },
    }),
  });

  console.log("Status:", response.status);
  const data = await response.text();
  console.log("Data:", data);
}

testHF();
