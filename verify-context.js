import MODELS from "./config/models.js";

console.log("Verifying Model Context Limits...");

let allPassed = true;

for (const [key, model] of Object.entries(MODELS)) {
  if (!model.contextLimit) {
    console.error(`❌ Model ${model.name} (${key}) is missing contextLimit!`);
    allPassed = false;
  } else {
    console.log(`✅ ${model.name}: ${model.contextLimit} chars`);
  }
}

if (allPassed) {
  console.log("\nAll models have context limits configured correctly.");
} else {
  console.log("\nSome models are missing configuration.");
  process.exit(1);
}
