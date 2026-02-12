import dotenv from "dotenv";
import { getModel, listModels } from "./config/models.js";
import { createClient } from "./config/apiClient.js";

dotenv.config();

async function testModel(m) {
  console.log(`\n👉 Testing: ${m.name} (${m.id})`);
  try {
    const config = getModel(m.key);
    const client = createClient(config.apiKey);
    
    // Add timeout via AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout
    
    const start = Date.now();
    const response = await client.chat.completions.create({
      model: config.id,
      messages: [{ role: "user", content: "Say 'ok'" }],
      max_tokens: 5,
      temperature: 0.1
    }, { signal: controller.signal });
    
    clearTimeout(timeout);
    
    const reply = response.choices[0]?.message?.content;
    const finishReason = response.choices[0]?.finish_reason;
    const duration = Date.now() - start;

    if (reply) {
        console.log(`   ✅ PASSED (${duration}ms): "${reply.trim()}"`);
    } else {
        console.log(`   ✅ PASSED (${duration}ms): [No content] (Reason: ${finishReason})`);
        console.log(`      Full response: ${JSON.stringify(response.choices[0])}`);
    }
    return true;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log(`   ❌ FAILED: Timeout (over 60s)`);
    } else {
      console.log(`   ❌ FAILED: ${e.message}`);
      if (e.message.includes("Missing API key")) {
        console.log(`      Action: Check ${m.key.toUpperCase()}_API_KEY in .env`);
      }
    }
    return false;
  }
}

async function run() {
  const models = listModels();
  console.log(`🔎 Verifying ${models.length} models...`);
  
  for (const m of models) {
    await testModel(m);
  }
  console.log("\nDone.");
}

run();
