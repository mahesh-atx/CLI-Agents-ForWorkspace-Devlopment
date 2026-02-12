import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import readline from "readline";
import sharp from "sharp";
import { createPatch } from "diff";
import { getModel, listModels } from "./config/models.js";
import { createClient } from "./config/apiClient.js";

dotenv.config();

/* ================= CONFIG ================= */

const MEMORY_FILE = ".devai_memory.json";

/* ================= INPUT ================= */

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans.trim()); }));
}

/* ================= PROJECT DETECT ================= */

function detectProjectType(dir) {
  try {
    const check = (f) => fs.existsSync(path.join(dir, f));
    if (check("package.json")) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.dependencies?.react) return "React App";
      if (pkg.dependencies?.express) return "Node Express API";
      return "Node Project";
    }
    if (check("index.html")) return "Static Web";
    if (check("requirements.txt")) return "Python";
  } catch {}
  return "Empty / Unknown";
}

/* ================= SMART CONTEXT SELECTOR ================= */

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
  ".mp4", ".mp3", ".wav", ".ogg",
  ".zip", ".tar", ".gz", ".rar",
  ".pdf", ".doc", ".docx", ".xls",
  ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".eot",
  ".lock"
]);

const SKIP_NAMES = new Set(["node_modules", ".git", ".devai_memory.json", "_devai_last_response.txt"]);
const CONFIG_FILES = new Set(["package.json", ".env", ".env.example", "tsconfig.json", "vite.config.js", "webpack.config.js"]);
const MAX_CONTEXT_CHARS = 12000;

function collectFiles(dir) {
  const files = [];
  function walk(d, prefix = "") {
    let entries;
    try { entries = fs.readdirSync(d); } catch { return; }
    for (const f of entries) {
      if (SKIP_NAMES.has(f)) continue;
      const full = path.join(d, f);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      const rel = path.relative(dir, full);
      if (stat.isDirectory()) {
        walk(full, rel);
      } else if (stat.size < 100000 && !BINARY_EXTS.has(path.extname(f).toLowerCase())) {
        try {
          const content = fs.readFileSync(full, "utf8");
          const nonPrintable = content.slice(0, 500).split("").filter(c => c.charCodeAt(0) < 32 && c !== "\n" && c !== "\r" && c !== "\t").length;
          if (nonPrintable < 5) {
            const lines = content.split("\n").length;
            files.push({ path: rel, content, lines, size: stat.size, mtime: stat.mtimeMs });
          }
        } catch {}
      }
    }
  }
  try { walk(dir); } catch (e) {
    console.log("⚠️  Warning: Could not fully read codebase:", e.message);
  }
  return files;
}

function scoreRelevance(file, keywords) {
  let score = 0;
  const name = file.path.toLowerCase();
  const basename = path.basename(name);

  // Config files always important
  if (CONFIG_FILES.has(basename)) score += 10;

  // Entry points
  if (basename === "index.js" || basename === "index.html" || basename === "app.js" || basename === "main.js") score += 5;

  // Recently modified files get a boost
  const ageMinutes = (Date.now() - file.mtime) / 60000;
  if (ageMinutes < 30) score += 4;
  else if (ageMinutes < 120) score += 2;

  // Keyword matching against path and content
  for (const kw of keywords) {
    if (name.includes(kw)) score += 6;
    if (file.content.toLowerCase().includes(kw)) score += 2;
  }

  return score;
}

function buildSmartContext(dir, userInput) {
  const files = collectFiles(dir);
  if (files.length === 0) return "(empty project)";

  // Build file tree
  const tree = files.map(f => `  ${f.path} (${f.lines} lines)`).join("\n");

  // Extract keywords from user input (words 3+ chars, lowercased)
  const keywords = userInput.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3);

  // Score and sort files by relevance
  const scored = files.map(f => ({ ...f, score: scoreRelevance(f, keywords) }))
    .sort((a, b) => b.score - a.score);

  // Build context within budget
  let context = `📁 File Tree (${files.length} files):\n${tree}\n\n`;
  let used = context.length;
  const fullFiles = [];
  const previews = [];

  for (const f of scored) {
    const fullEntry = `--- ${f.path} ---\n${f.content}\n`;
    if (used + fullEntry.length < MAX_CONTEXT_CHARS) {
      fullFiles.push(fullEntry);
      used += fullEntry.length;
    } else {
      // Add a short preview instead
      const preview = f.content.split("\n").slice(0, 5).join("\n");
      const previewEntry = `--- ${f.path} (preview) ---\n${preview}\n`;
      if (used + previewEntry.length < MAX_CONTEXT_CHARS) {
        previews.push(previewEntry);
        used += previewEntry.length;
      }
    }
  }

  if (fullFiles.length > 0) context += `📄 Full Files (${fullFiles.length}):\n${fullFiles.join("\n")}`;
  if (previews.length > 0) context += `\n📝 Previews:\n${previews.join("\n")}`;

  return context;
}

/* ================= PATCH WRITER ================= */

function patchFile(projectDir, filePath, newContent) {
  // Sanitize path — prevent writing outside project folder
  const normalized = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.resolve(projectDir, normalized);
  
  // Security: ensure the file stays within the project directory
  if (!fullPath.startsWith(path.resolve(projectDir))) {
    console.log("❌ Blocked:", filePath, "(path escape attempt)");
    return;
  }

  try {
    // Ensure the directory exists
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, newContent, "utf8");
      console.log("  📄 Created:", normalized);
      return;
    }

    const oldContent = fs.readFileSync(fullPath, "utf8");
    if (oldContent === newContent) {
      console.log("  ✓ No change:", normalized);
      return;
    }

    const patch = createPatch(filePath, oldContent, newContent);
    fs.writeFileSync(fullPath, newContent, "utf8");
    console.log("  🛠 Patched:", normalized);
  } catch (e) {
    console.log("  ❌ Failed to write:", normalized, "—", e.message);
  }
}

/* ================= JSON REPAIR ================= */

function cleanText(text) {
  return text
    .replace(/\u201C/g, '"')    // left curly quote → straight
    .replace(/\u201D/g, '"')    // right curly quote → straight
    .replace(/\u2018/g, "'")    // left single curly → straight
    .replace(/\u2019/g, "'")    // right single curly → straight
    .replace(/\u00A0/g, " ")    // non-breaking space → space
    .replace(/,\s*}/g, "}")     // trailing comma before }
    .replace(/,\s*]/g, "]");    // trailing comma before ]
}

function parseJSON(text) {
  if (!text || typeof text !== "string") return null;

  // Attempt 1: direct parse
  try { return JSON.parse(text); } catch {}

  // Attempt 2: extract JSON from markdown fences
  try {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      return JSON.parse(cleanText(fenceMatch[1].trim()));
    }
  } catch {}

  // Attempt 3: clean + parse whole text
  try {
    let fixed = text
      .replace(/```json/g, "")
      .replace(/```/g, "");
    return JSON.parse(cleanText(fixed.trim()));
  } catch {}

  // Attempt 4: find first { ... last } in the text
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleanText(text.slice(start, end + 1)));
    }
  } catch {}

  // Attempt 5: find JSON array pattern for files
  try {
    const planMatch = text.match(/"plan"\s*:\s*\[/);
    const filesMatch = text.match(/"files"\s*:\s*\[/);
    if (planMatch || filesMatch) {
      // There IS json-like content, try aggressive cleanup
      let aggressive = text
        .replace(/^[^{]*/, "")     // remove everything before first {
        .replace(/[^}]*$/, "");    // remove everything after last }
      return JSON.parse(cleanText(aggressive));
    }
  } catch {}

  return null;
}

/* ================= MODEL SELECTION ================= */

console.log("\n🚀 Advanced DevAI — Autonomous Software Engineer\n");
console.log("Select a model:");

const availableModels = listModels();
availableModels.forEach((m, i) => {
  console.log(`  ${i + 1}. ${m.name} (${m.description})`);
});

const modelChoice = await ask(`\nSelect (1-${availableModels.length}): `);
const choiceIndex = parseInt(modelChoice, 10) - 1;

if (choiceIndex < 0 || choiceIndex >= availableModels.length) {
  console.log("⚠️  Invalid choice, defaulting to model 1.");
}

const selectedKey = availableModels[choiceIndex]?.key || availableModels[0].key;

let modelConfig, client;
try {
  modelConfig = getModel(selectedKey);
  client = createClient(modelConfig.apiKey);
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  console.error("   Make sure your .env file exists and has the correct API keys.");
  process.exit(1);
}

/* ================= PROJECT FOLDER ================= */

const projectName = await ask("Project folder name (or '.' for current dir): ");
let projectDir;

if (projectName === "." || projectName === "") {
  projectDir = process.cwd();
} else {
  projectDir = path.resolve(process.cwd(), projectName);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
    console.log(`\n📁 Created project folder: ${projectDir}`);
  } else {
    console.log(`\n📁 Using existing folder: ${projectDir}`);
  }
}

/* ================= MEMORY ================= */

const memoryPath = path.join(projectDir, MEMORY_FILE);
let messages = [];

// Load memory safely
try {
  if (fs.existsSync(memoryPath)) {
    const raw = fs.readFileSync(memoryPath, "utf8");
    const loaded = JSON.parse(raw);
    if (Array.isArray(loaded) && loaded.length > 0) {
      messages = loaded;
    } else {
      throw new Error("Invalid memory format");
    }
  }
} catch (e) {
  console.log("⚠️  Memory file was corrupted, starting fresh.");
}

if (messages.length === 0) {
  messages = [{
    role: "system",
    content: `
You are DevAI — Autonomous Software Engineer.

Capabilities:
- Understand existing codebase
- Plan before coding
- Modify existing files (patch, not overwrite)
- Create new files and folders
- Debug errors
- Refactor multiple files
- Detect project type
- Learn user's coding style from memory

ALWAYS RETURN VALID JSON ONLY — no markdown, no explanation outside JSON:

{
 "plan": ["step1","step2"],
 "files":[ { "path":"relative/path/file.js","content":"full file code here" } ],
 "instructions":[ "how to run manually" ]
}

CRITICAL RULES:
- File paths MUST be relative (e.g. "src/index.js", "routes/auth.js")
- The "content" field must contain the COMPLETE file content
- Do NOT wrap the JSON in markdown code fences
- Do NOT use curly/smart quotes — use straight quotes only
- Do NOT add any text before or after the JSON
`
  }];
}

function trimMemory() {
  if (messages.length > 20) messages.splice(1, messages.length - 20);
}

/* ================= MAIN LOOP ================= */

console.log(`\nModel: ${modelConfig.name} (${modelConfig.id})`);
console.log(`Project: ${detectProjectType(projectDir)} — ${projectDir}`);
console.log("Type 'exit' to quit\n");

while (true) {
  const input = await ask("You: ");
  if (!input || input.toLowerCase() === "exit") break;

  const imgPath = await ask("Image (optional / none): ");
  let imgBase64 = null;

  if (imgPath && imgPath.toLowerCase() !== "none") {
    try {
      if (!fs.existsSync(imgPath)) {
        console.log("⚠️  Image not found:", imgPath);
      } else {
        const buf = await sharp(imgPath).resize(1024).jpeg({ quality: 80 }).toBuffer();
        imgBase64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
        console.log("✓ Image loaded");
      }
    } catch (e) {
      console.log("⚠️  Could not load image:", e.message);
    }
  }

  const smartContext = buildSmartContext(projectDir, input);

  const userText = `User request: ${input}\nProject: ${detectProjectType(projectDir)}\nProject folder: ${projectDir}\n\n${smartContext}`;

  const content = imgBase64
    ? [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: imgBase64 } }
      ]
    : userText;

  messages.push({ role: "user", content });
  trimMemory();

  process.stdout.write("DevAI: Planning & coding");

  let reply = "";

  for (let i = 0; i < 3; i++) {
    try {
      // Use streaming to avoid timeout on large responses
      const stream = await client.chat.completions.create({
        model: modelConfig.id,
        messages,
        temperature: modelConfig.temperature,
        top_p: modelConfig.topP,
        max_tokens: modelConfig.maxTokens,
        stream: true,
        ...modelConfig.extraParams
      });

      let chunks = "";
      let chunkCount = 0;
      const detectedFiles = new Set();

      // Live progress: show detected file paths as they stream in
      let progressTimer = setInterval(() => {
        process.stdout.write(".");
      }, 3000);

      for await (const chunk of stream) {
        chunkCount++;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          chunks += delta;
          // Try to detect file paths as they appear in the stream
          const pathMatches = chunks.match(/"path"\s*:\s*"([^"]+)"/g);
          if (pathMatches) {
            for (const m of pathMatches) {
              const fp = m.match(/"path"\s*:\s*"([^"]+)"/)[1];
              if (!detectedFiles.has(fp)) {
                detectedFiles.add(fp);
                clearInterval(progressTimer);
                process.stdout.write(`\n  📦 Generating: ${fp}`);
                progressTimer = setInterval(() => process.stdout.write("."), 3000);
              }
            }
          }
        }
      }
      clearInterval(progressTimer);
      reply = chunks;

      if (reply.trim()) {
        console.log(` ✓ (${reply.length} chars)`);
        break;
      }
      console.log(`\n⚠️  Empty response (got ${chunkCount} chunks), retrying (${i + 1}/3)...`);
    } catch (e) {
      console.log(`\n❌ Attempt ${i + 1}/3 failed: ${e.message}`);
      if (e.status === 401) {
        console.log("   API key is invalid. Check your .env file.");
        break;
      }
      if (e.status === 429) {
        console.log("   Rate limited. Waiting 5 seconds...");
        await new Promise(r => setTimeout(r, 5000));
      }
      if (i < 2) console.log("   Retrying...");
    }
  }

  if (!reply.trim()) {
    console.log("\n⚠️  No response received. Try again or switch model.\n");
    // Remove the failed user message from memory
    messages.pop();
    continue;
  }

  messages.push({ role: "assistant", content: reply });
  
  try {
    fs.writeFileSync(memoryPath, JSON.stringify(messages, null, 2));
  } catch (e) {
    console.log("⚠️  Warning: Could not save memory:", e.message);
  }

  // Auto-detect and strip leading explanation text
  if (!reply.trim().startsWith("{")) {
    const jsonStart = reply.indexOf("{");
    if (jsonStart !== -1) reply = reply.slice(jsonStart);
  }

  const parsed = parseJSON(reply);

  if (!parsed) {
    console.log("\n⚠️  Could not parse AI response as JSON.");
    console.log("   The AI replied with text instead of structured output.");
    
    // Save raw response so user can inspect it
    const rawFile = path.join(projectDir, "_devai_last_response.txt");
    fs.writeFileSync(rawFile, reply);
    console.log(`   Raw response saved to: ${rawFile}`);
    console.log("   Tip: Try asking again with a simpler request.\n");
    continue;
  }

  if (parsed.plan) {
    console.log("\n🧠 Plan:");
    parsed.plan.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  }

  if (parsed.files && Array.isArray(parsed.files)) {
    console.log(`\n📂 Writing ${parsed.files.length} file(s):`);
    for (const f of parsed.files) {
      if (!f.path || typeof f.content !== "string") {
        console.log("  ❌ Skipped invalid file entry (missing path or content)");
        continue;
      }
      patchFile(projectDir, f.path, f.content);
    }
  }

  if (parsed.instructions) {
    console.log("\n📌 How to Run:");
    parsed.instructions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }

  console.log("\n✅ Done\n");
}

console.log("\n👋 Goodbye!\n");
