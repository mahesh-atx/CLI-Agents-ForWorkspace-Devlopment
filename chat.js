import dotenv from "dotenv";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { getModel, listModels } from "./config/models.js";
import { createClient } from "./config/apiClient.js";

dotenv.config();

async function getUserInput(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function encodeImage(imagePath) {
  const cleanPath = imagePath.replace(/^["'](.+)["']$/, "$1");
  try {
    const imageBuffer = fs.readFileSync(cleanPath);
    const extension = path.extname(cleanPath).toLowerCase().replace(".", "");
    const mimeType = extension === "png" ? "image/png" : "image/jpeg";
    return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  } catch (error) {
    console.error(`Error reading image: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log("--- AI Code Assistant (Multimodal & Persistent) ---");
  console.log("Select a model:");

  // Build menu dynamically from model registry
  const availableModels = listModels();
  availableModels.forEach((m, i) => {
    console.log(`${i + 1}. ${m.name} (${m.description})`);
  });

  const choice = await getUserInput(`Select (1-${availableModels.length}): `);
  const choiceIndex = parseInt(choice, 10) - 1;
  const selectedKey = availableModels[choiceIndex]?.key || availableModels[0].key;

  const modelConfig = getModel(selectedKey);
  const openai = createClient(modelConfig.apiKey);

  // Conversation memory
  const messages = [
    {
      role: "system",
      content: "You are an expert AI assistant. If an image is provided, analyze it accurately. If code is requested, provide only clean, production-ready code without unnecessary commentary. Maintain context of the conversation for follow-up requests."
    }
  ];

  console.log(`\nUsing: ${modelConfig.name} (${modelConfig.id})`);
  console.log("(Type 'exit' or 'quit' to end the chat)");

  while (true) {
    const userMessage = await getUserInput("\nYou: ");

    if (userMessage.toLowerCase() === "exit" || userMessage.toLowerCase() === "quit") {
      console.log("Goodbye!");
      break;
    }

    let imageBase64 = null;
    if (modelConfig.isMultimodal) {
      const imagePath = await getUserInput("Image Path (optional, or 'none'): ");
      if (imagePath.trim() && imagePath.toLowerCase() !== "none") {
        imageBase64 = encodeImage(imagePath.trim());
      }
    }

    if (!userMessage.trim() && !imageBase64) {
      console.log("Please provide a message or an image.");
      continue;
    }

    // Prepare message content based on vision support
    let currentContent;
    if (imageBase64) {
      currentContent = [
        { type: "text", text: userMessage || "Analyze this image." },
        { type: "image_url", image_url: { url: imageBase64 } }
      ];
    } else {
      currentContent = userMessage;
    }

    messages.push({ role: "user", content: currentContent });

    // --- Thinking Indicator ---
    process.stdout.write(`\nAssistant (${modelConfig.name}): Thinking...`);
    let firstChunk = true;

    try {
      const completion = await openai.chat.completions.create({
        model: modelConfig.id,
        messages: messages,
        temperature: modelConfig.temperature,
        top_p: modelConfig.topP,
        max_tokens: modelConfig.maxTokens,
        stream: true,
        ...modelConfig.extraParams,
      });

      let fullResponse = "";
      for await (const chunk of completion) {
        if (firstChunk) {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(`Assistant (${modelConfig.name}): `);
          firstChunk = false;
        }

        const deltaContent = chunk.choices?.[0]?.delta?.content;
        if (deltaContent) {
          process.stdout.write(deltaContent);
          fullResponse += deltaContent;
        }
      }

      // Store AI response in history
      messages.push({ role: "assistant", content: fullResponse });

    } catch (error) {
      if (firstChunk) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
      }
      console.error("\nError:", error.message);
    }

    console.log("\n" + "-".repeat(30));
  }
}

main().catch(console.error);
