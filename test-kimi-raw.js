import https from "https";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.NVIDIA_API_KEY_KIMI; // Use env var
// const apiKey = "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"; // User provided (commented out for safety)

if (!apiKey) {
  console.error("No API Key found in env!");
  process.exit(1);
}

const data = JSON.stringify({
  model: "moonshotai/kimi-k2.5",
  messages: [{ role: "user", content: "Hello" }], // Content cannot be empty string usually
  max_tokens: 16384,
  temperature: 1.00,
  top_p: 1.00,
  stream: true,
  chat_template_kwargs: { thinking: true }
});

const options = {
  hostname: "integrate.api.nvidia.com",
  path: "/v1/chat/completions",
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "text/event-stream"
  }
};

console.log("Testing Kimi with raw Node.js https...");

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  res.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim().startsWith("data: ")) {
        const jsonStr = line.replace("data: ", "").trim();
        if (jsonStr === "[DONE]") {
          console.log("\n[DONE]");
          return;
        }
        try {
          const json = JSON.parse(jsonStr);
          const content = json.choices[0]?.delta?.content;
          if (content) process.stdout.write(content);
        } catch (e) {
          // ignore parse errors for partial chunks
        }
      }
    }
  });

  res.on("end", () => console.log("\nStream ended."));
});

req.on("error", (e) => console.error(`Problem with request: ${e.message}`));
req.write(data);
req.end();
