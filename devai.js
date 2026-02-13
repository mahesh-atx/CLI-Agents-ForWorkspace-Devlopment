import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import readline from "readline";
import sharp from "sharp";
import { createPatch } from "diff";
import { execSync } from "child_process";
import chalk from "chalk";
import { getModel, listModels } from "./config/models.js";
import { createClient } from "./config/apiClient.js";

dotenv.config();

/* ================= CONFIG ================= */

const MEMORY_FILE = ".devai_memory.json";
let customBuildCmd = null;  // User-set build command via /build <cmd>

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

function buildSmartContext(dir, userInput, maxChars = 12000) {
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
    if (used + fullEntry.length < maxChars) {
      fullFiles.push(fullEntry);
      used += fullEntry.length;
    } else {
      // Add a short preview instead
      const preview = f.content.split("\n").slice(0, 5).join("\n");
      const previewEntry = `--- ${f.path} (preview) ---\n${preview}\n`;
      if (used + previewEntry.length < maxChars) {
        previews.push(previewEntry);
        used += previewEntry.length;
      }
    }
  }

  if (fullFiles.length > 0) context += `📄 Full Files (${fullFiles.length}):\n${fullFiles.join("\n")}`;
  if (previews.length > 0) context += `\n📝 Previews:\n${previews.join("\n")}`;

  return context;
}

/* ================= FUZZY SEARCH ================= */

function similarity(a, b) {
  // Levenshtein-based similarity ratio (0..1)
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;
  if (la > 5000 || lb > 5000) {
    // For very long strings, use line-based comparison
    const aLines = a.split("\n").map(l => l.trim()).filter(Boolean);
    const bLines = b.split("\n").map(l => l.trim()).filter(Boolean);
    let matches = 0;
    for (const line of aLines) {
      if (bLines.includes(line)) matches++;
    }
    return matches / Math.max(aLines.length, bLines.length);
  }
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[la][lb] / Math.max(la, lb);
}

function fuzzyFindAndReplace(fileContent, search, replace) {
  // Exact match first
  const idx = fileContent.indexOf(search);
  if (idx !== -1) {
    return fileContent.slice(0, idx) + replace + fileContent.slice(idx + search.length);
  }

  // Trimmed-whitespace match: normalize leading whitespace
  const searchLines = search.split("\n").map(l => l.trimEnd());
  const fileLines = fileContent.split("\n");
  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (fileLines[i + j].trimEnd() !== searchLines[j]) { match = false; break; }
    }
    if (match) {
      const before = fileLines.slice(0, i);
      const after = fileLines.slice(i + searchLines.length);
      return [...before, replace, ...after].join("\n");
    }
  }

  // Fuzzy sliding window match (similarity > 0.8)
  const searchNorm = search.trim();
  const windowSize = searchLines.length;
  let bestScore = 0, bestIdx = -1;
  for (let i = 0; i <= fileLines.length - windowSize; i++) {
    const window = fileLines.slice(i, i + windowSize).join("\n").trim();
    const score = similarity(searchNorm, window);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestScore >= 0.8 && bestIdx >= 0) {
    const before = fileLines.slice(0, bestIdx);
    const after = fileLines.slice(bestIdx + windowSize);
    console.log(`    ↳ Fuzzy matched (${(bestScore * 100).toFixed(0)}% similar)`);
    return [...before, replace, ...after].join("\n");
  }

  return null; // No match found
}

/* ================= PATCH WRITER ================= */

function patchFile(projectDir, filePath, newContent, edits = null) {
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

    // === SURGICAL EDIT MODE (search/replace) ===
    if (edits && Array.isArray(edits) && edits.length > 0) {
      if (!fs.existsSync(fullPath)) {
        console.log("  ❌ Cannot edit (file doesn't exist):", normalized);
        return;
      }
      let content = fs.readFileSync(fullPath, "utf8");
      let applied = 0, failed = 0;

      for (const edit of edits) {
        if (!edit.search || typeof edit.replace !== "string") {
          console.log("    ⚠️  Skipped invalid edit (missing search/replace)");
          failed++;
          continue;
        }
        const result = fuzzyFindAndReplace(content, edit.search, edit.replace);
        if (result !== null) {
          content = result;
          applied++;
        } else {
          console.log(`    ⚠️  Could not find match for search block (${edit.search.split("\n").length} lines)`);
          failed++;
        }
      }

      fs.writeFileSync(fullPath, content, "utf8");
      console.log(`  🔧 Surgical edit: ${normalized} (${applied} applied, ${failed} failed)`);
      return;
    }

    // === FULL OVERWRITE MODE (backward-compatible) ===
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

/* ================= BUILD COMMAND DETECTION ================= */

function detectBuildCommand(dir) {
  if (customBuildCmd) return customBuildCmd;

  try {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts || {};
      // Priority: test > build > lint > start
      if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') return "npm test";
      if (scripts.build) return "npm run build";
      if (scripts.lint) return "npm run lint";
      return null;
    }
    if (fs.existsSync(path.join(dir, "requirements.txt"))) return "python -m pytest";
    if (fs.existsSync(path.join(dir, "Cargo.toml"))) return "cargo build";
    if (fs.existsSync(path.join(dir, "go.mod"))) return "go build ./...";
  } catch {}
  return null;
}

/* ================= SELF-DEBUGGER LOOP ================= */

async function selfDebugLoop(projectDir, messages, client, modelConfig, maxAttempts = 3) {
  const buildCmd = detectBuildCommand(projectDir);
  if (!buildCmd) {
    console.log("\n⚠️  No build/test command detected.");
    console.log("   Use: /build <command>  to set one (e.g. /build npm test)");
    return;
  }

  console.log(`\n🔨 Running: ${buildCmd}`);
  console.log("─".repeat(50));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const output = execSync(buildCmd, {
        cwd: projectDir,
        encoding: "utf8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"]
      });
      console.log(output.slice(0, 1000));
      console.log(`\n✅ Build/test PASSED on attempt ${attempt}!`);
      return true;
    } catch (e) {
      const errorOutput = (e.stderr || "") + (e.stdout || "") || e.message;
      const truncatedError = errorOutput.slice(0, 2000);
      console.log(`\n🔴 Build FAILED (attempt ${attempt}/${maxAttempts}):`);
      console.log(truncatedError.slice(0, 500));

      if (attempt >= maxAttempts) {
        console.log(`\n❌ Max attempts (${maxAttempts}) reached. Manual fix needed.`);
        return false;
      }

      // Feed error back to AI for auto-fix
      console.log(`\n🤖 Asking AI to fix (attempt ${attempt + 1}/${maxAttempts})...`);
      process.stdout.write("DevAI: Analyzing error");

      const smartContext = buildSmartContext(projectDir, "fix build error", modelConfig.contextLimit || 12000);
      messages.push({
        role: "user",
        content: `BUILD/TEST FAILED. Fix this error:\n\n\`\`\`\n${truncatedError}\`\`\`\n\nProject context:\n${smartContext}\n\nReturn the fixed file(s) as JSON. Use surgical edits when possible.`
      });

      let reply = "";
      try {
        const stream = await client.chat.completions.create({
          model: modelConfig.id,
          messages,
          temperature: modelConfig.temperature,
          top_p: modelConfig.topP,
          max_tokens: modelConfig.maxTokens,
          stream: true,
          ...modelConfig.extraParams
        });

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) reply += delta;
        }
      } catch (apiErr) {
        console.log(`\n❌ AI API error: ${apiErr.message}`);
        return false;
      }

      if (!reply.trim()) {
        console.log("\n⚠️  AI returned empty response.");
        return false;
      }

      console.log(" ✓");
      messages.push({ role: "assistant", content: reply });

      const parsed = parseJSON(reply);
      if (!parsed || !parsed.files) {
        console.log("⚠️  Could not parse AI fix response.");
        return false;
      }

      // Apply fixes
      console.log(`\n📂 Applying ${parsed.files.length} fix(es):`);
      for (const f of parsed.files) {
        if (!f.path) continue;
        if (f.edits && Array.isArray(f.edits)) {
          patchFile(projectDir, f.path, null, f.edits);
        } else if (typeof f.content === "string") {
          patchFile(projectDir, f.path, f.content);
        }
      }

      console.log(`\n🔄 Retrying build...`);
    }
  }
  return false;
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

/* ================= GIT ROLLBACK SYSTEM ================= */

function gitCheckpoint() {
  try {
    // 1. Check if git repo exists
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  } catch {
    return null; // Not a git repo
  }

  try {
    // 2. Check if there are changes to stash
    const status = execSync("git status --porcelain").toString().trim();
    if (!status) return "clean"; // Nothing to backup, just a clean state

    // 3. Create Backup: Stash everything (including untracked) but keep the index
    // We use 'push' to save it, then 'apply' to bring it back to working dir
    console.log(chalk.gray(" 💾 Creating safety checkpoint..."));
    execSync('git stash push --include-untracked -m "DevAI_Auto_Checkpoint"');
    execSync('git stash apply'); // Restore immediately so AI sees the code
    return "stashed";
  } catch (e) {
    console.log(chalk.yellow("⚠️  Git checkpoint failed: " + e.message));
    return null;
  }
}

function gitRestore(checkpointType) {
  try {
    console.log(chalk.gray(" ↺ Rolling back changes..."));
    // 1. Wipe all current changes (AI's changes)
    execSync("git reset --hard HEAD", { stdio: "ignore" });
    execSync("git clean -fd", { stdio: "ignore" }); // Remove new files created by AI

    // 2. If we had a stash, restore it
    if (checkpointType === "stashed") {
      execSync("git stash pop", { stdio: "ignore" }); // Restore user's WIP
    }
    console.log(chalk.green(" ✅ Rollback complete."));
  } catch (e) {
    console.log(chalk.red("❌ Rollback failed: " + e.message));
    console.log("   (You may need to manually run 'git stash pop')");
  }
}

function gitDiscard(checkpointType) {
  if (checkpointType === "stashed") {
    // We accepted the changes, so we drop the backup stash to keep the list clean
    try {
      execSync("git stash drop", { stdio: "ignore" });
    } catch {}
  }
}

// Helper to recover truncated JSON (e.g. if max_tokens hit)
function recoverTruncatedJSON(text) {
  // 1. Find the "files" array
  const filesMatch = text.match(/"files"\s*:\s*\[/);
  if (!filesMatch) return null;
  
  const startIndex = filesMatch.index + filesMatch[0].length;
  let nesting = 0;
  let lastCompleteObjIndex = -1;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') {
        nesting++;
      } else if (char === '}') {
        nesting--;
        // If we just closed a file object (nesting went 1 -> 0 assumed relative to array start? 
        // Actually, inside array, objects are at nesting 1?
        // Let's track absolute nesting. 
        // We start inside "files": [ ... <- nesting is unknown relative to root, but we can track relative.
      }
    }
  }
  
  // Complexity of bracket tracking is high.
  // SIMPLER HEURISTIC: Find last occurrence of "}," which signifies end of a file object,
  // followed by a "path" or end of array.
  
  // Look for pattern:  }, \n\s* { "path"
  // Or just find the last "}," and cut there.
  
  const lastClosing = text.lastIndexOf("},"); // Finds last strict object end
  const lastClosingBracket = text.lastIndexOf("}"); // Finds very last bracket (maybe partial)

  // If text ends abruptly, we might have ... "conte
  
  // Try to find the last occurrence of `    },` or `  },` which usually ends a file block in pretty-print
  // Regex for object end: /\}\s*,\s*\{/
  // We want to slice up to the last successful "}," and add "] }".
  
  // Let's try progressively cutting from the end until it parses.
  // Limit attempts to avoid infinite loop.
  
  let buffer = text;
  // Try adding closing chars
  try { return JSON.parse(buffer + "]}"); } catch {}
  try { return JSON.parse(buffer + "\"]}]}"); } catch {} // Close string, obj, array, root
  return null; 
}

// STRONGER RECOVERY: Regex Extraction
function extractFilesRegex(text) {
    const files = [];
    // Regex to find "path": "...", ... "content": "..."
    // We capture content robustly? No, content can contain anything.
    // But we know 'content' starts with ", and ends with " (not escaped) followed by }
    
    // Iterative approach:
    // 1. Find "path": "..."
    // 2. Find "action": "..."
    // 3. Find "content": "..."
    // 4. Extract content string, unescape it.
    
    const pathRegex = /"path"\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = pathRegex.exec(text)) !== null) {
         // for each path, try to find the content
         const path = match[1];
         // Find 'content': starting after this path
         const contentStartSearch = text.indexOf('"content"', match.index);
         if (contentStartSearch === -1) continue;
         
         const contentValueStart = text.indexOf('"', contentStartSearch + 9) + 1;
         // Now read until unescaped quote
         let content = "";
         let p = contentValueStart;
         while (p < text.length) {
             if (text[p] === '\\') {
                 // escape char
                 if (p + 1 < text.length) {
                    content += text[p] + text[p+1]; // keep escape for JSON.parse later
                    p += 2;
                    continue;
                 }
             }
             if (text[p] === '"') {
                 // End of content string?
                 // Check if it's followed by } or ,
                 // A heuristic: usually followed by \n or space or }
                 break;
             }
             content += text[p];
             p++;
         }
         
         // Unescape the content
         try {
            const unescaped = JSON.parse(`"${content}"`);
            files.push({ path, action: "create", content: unescaped });
         } catch(e) {
            // failed to parse content, maybe truncated
         }
    }
    return files.length > 0 ? { files } : null;
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
    const cleaned = cleanText(text);
    return JSON.parse(cleaned);
  } catch {}

  // Attempt 4: Find first { and last }
  try {
    const firstOpen = text.indexOf("{");
    const lastClose = text.lastIndexOf("}");
    if (firstOpen !== -1 && lastClose !== -1) {
      return JSON.parse(cleanText(text.slice(firstOpen, lastClose + 1)));
    }
  } catch {}

  // Attempt 5: Recover from Truncation (Regex Extraction)
  try {
      // Only try recovery if other methods failed and we suspect truncation (large or partial)
      // Actually, just try it.
      const recovered = extractFilesRegex(text);
      if (recovered && recovered.files.length > 0) {
          console.log(`\n⚠️  JSON parse failed, but recovered ${recovered.files.length} files from content.`);
          return recovered;
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
You are DevAI — an Elite Senior Software Engineer and Architect.

==================== 1. TECH STACK STRATEGY ====================
- **ANALYZE FIRST**: Check input for specific tech (Bootstrap, jQuery, Vue, Python, Raw CSS).
- **IF SPECIFIED**: STRICTLY follow user request. Do NOT override.
- **IF NOT SPECIFIED**: Default to Modern Stack:
  - Frontend: React (Vite) + Tailwind CSS (via CDN for single files)
  - Backend: Node.js (Express)
  - Scripting: Node.js or Python
- **QUALITY**: Produce Production-Ready, clean, responsive, premium code.
- **NO PLACEHOLDERS**: Never write "TODO" or "Add logic here". Write the logic.

==================== 2. OUTPUT FORMAT (STRICT) ====================
- RETURN VALID JSON ONLY.
- NO markdown code blocks (no \`\`\`).
- NO preamble or postscript.
- IF NOT JSON → INVALID.

==================== 3. FILE EDITING RULES (CRITICAL) ====================
- **PREFER EDITS**: Use "action": "edit" for existing files.
- **CONTEXT**: "search" block must be UNIQUE enough to find the location.
- **WHITESPACE**: Preserve exact indentation in "search" blocks.
- **SCOPE**: Only rewrite the whole file ("action": "create") if changing >50% of the content.

==================== 4. DESIGN STANDARDS ====================
- Aesthetic: Modern, clean, premium (Apple/Stripe inspired).
- Layout: Fully responsive (mobile-first).
- Styling: Use CSS variables or Tailwind classes.

==================== 5. JSON STRUCTURES ====================

// OPTION A: NEW FILE / FULL REWRITE
{
  "plan": ["Scaffold component", "Add styles"],
  "files": [
    { "path": "src/components/Hero.jsx", "action": "create", "content": "..." }
  ]
}

// OPTION B: SURGICAL EDIT (Search & Replace)
{
  "plan": ["Fix validation bug"],
  "files": [
    {
      "path": "src/utils/validate.js",
      "action": "edit",
      "edits": [
        { 
          "search": "  if (x < 0) return false;", 
          "replace": "  if (x <= 0) return false;" 
        }
      ]
    }
  ]
}

// OPTION C: SHELL COMMANDS / INSTRUCTIONS
{
  "instructions": ["npm install framer-motion", "npm run dev"]
}

You can mix edits and creates in the same response.

CRITICAL RULES:
- File paths MUST be relative (e.g. "src/index.js", "routes/auth.js")
- For edits: the "search" field must contain the EXACT code block currently in the file
- For creates: the "content" field must contain the COMPLETE file content
- Keep search blocks as small as possible — only include the lines being changed plus 1-2 lines of context
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

  // Handle /build command
  if (input.startsWith("/build")) {
    const customCmd = input.slice(6).trim();
    if (customCmd) {
      customBuildCmd = customCmd;
      console.log(`\n✓ Build command set: ${customBuildCmd}`);
    }
    await selfDebugLoop(projectDir, messages, client, modelConfig);
    continue;
  }

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

  const smartContext = buildSmartContext(projectDir, input, modelConfig.contextLimit || 12000);

  // Full prompt for the AI (includes context)
  
  // --- NEW CODE START ---
  const styleHint = `
  REMINDER: 
  1. If I mentioned a specific tech stack, use it. 
  2. If not, use the Modern Default (React/Tailwind).
  3. Make the UI look premium and modern (Apple/Stripe aesthetic) unless I asked for "Retro" or "Basic".
  `;

  // Full prompt for the AI (includes context)
  const fullUserText = `User request: ${input}\n${styleHint}\nProject: ${detectProjectType(projectDir)}\nProject folder: ${projectDir}\n\n${smartContext}`;
  // --- NEW CODE END ---
  
  const apiContent = imgBase64
    ? [
        { type: "text", text: fullUserText },
        { type: "image_url", image_url: { url: imgBase64 } }
      ]
    : fullUserText;

  // Minimal prompt for history (excludes massive context bloat)
  const historyContent = imgBase64
    ? [
        { type: "text", text: input },
        { type: "image_url", image_url: { url: imgBase64 } }
      ]
    : input;

  // Prepare messages for this run: History + Current Full Prompt
  const apiMessages = [...messages, { role: "user", content: apiContent }];

  // Spinner for waiting
  let spinnerInt;
  const spinnerChars = ["|", "/", "-", "\\"];
  let spIndex = 0;
  
  process.stdout.write("DevAI: Planning & coding  ");
  spinnerInt = setInterval(() => {
    process.stdout.write(`\rDevAI: Planning & coding ${spinnerChars[spIndex++ % 4]} `);
  }, 100);

  let reply = "";

  for (let i = 0; i < 3; i++) {
    try {
      // Use streaming to avoid timeout on large responses
      const stream = await client.chat.completions.create({
        model: modelConfig.id,
        messages: apiMessages,
        temperature: modelConfig.temperature,
        top_p: modelConfig.topP,
        max_tokens: modelConfig.maxTokens,
        stream: true,
        ...modelConfig.extraParams
      });

      let chunks = "";
      let chunkCount = 0;
      const detectedFiles = new Set();


      for await (const chunk of stream) {
        // Clear spinner on first chunk
        if (spinnerInt) {
            clearInterval(spinnerInt);
            spinnerInt = null;
            process.stdout.write("\rDevAI: Planning & coding ... \n");
        }

        chunkCount++;
        const delta = chunk.choices?.[0]?.delta;
        
        // Handle Reasoning (Thinking)
        if (delta?.reasoning_content) {
          process.stdout.write(chalk.gray(delta.reasoning_content));
        }

        // Handle Content
        if (delta?.content) {
          chunks += delta.content;
          // Don't print raw JSON content to terminal
          // distinct from reasoning
          process.stdout.write(`\rGenerating response... (${chunks.length} chars)`);
        }
      }
      // clearInterval(progressTimer); // Removed
      process.stdout.write("\n"); // Newline after progress line
      reply = chunks;

      if (reply.trim()) {
        console.log(` ✓ Received full response.`);
        break;
      }
      console.log(`\n⚠️  Empty response (got ${chunkCount} chunks), retrying (${i + 1}/3)...`);
    } catch (e) {
      if (spinnerInt) { clearInterval(spinnerInt); spinnerInt = null; process.stdout.write("\n"); }
      console.log(`\n❌ Error: ${e.message}`);
      if (i === 2) console.log("Aborting after 3 attempts.");
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
    // No need to pop messages; we haven't pushed the user message yet
    continue;
  }

  // Update memory with minimal user message + assistant reply
  messages.push({ role: "user", content: historyContent });
  messages.push({ role: "assistant", content: reply });
  trimMemory();
  
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
    
    // 1. Create Checkpoint
    const checkpoint = gitCheckpoint();

    console.log(`\n📂 Writing ${parsed.files.length} file(s):`);
    for (const f of parsed.files) {
      if (!f.path) {
        console.log("  ❌ Skipped invalid file entry (missing path)");
        continue;
      }
      // Surgical edit mode: use search/replace edits
      if (f.edits && Array.isArray(f.edits)) {
        patchFile(projectDir, f.path, null, f.edits);
      } else if (typeof f.content === "string") {
        // Full overwrite mode (backward-compatible)
        patchFile(projectDir, f.path, f.content);
      } else {
        console.log("  ❌ Skipped invalid file entry (missing content or edits)");
      }
    }

    // 3. Verification Prompt (Only if checkpoint was possible)
    if (checkpoint) {
      const userAction = await ask(chalk.yellow("\n👀 Review changes. Keep them? (y/undo): "));
      
      if (userAction.toLowerCase() === "undo" || userAction.toLowerCase() === "n") {
        // 4a. UNDO
        gitRestore(checkpoint);
        // Remove the AI's response from memory so it forgets the bad code
        messages.pop(); 
        messages.pop(); 
        console.log(chalk.gray("   (Memory rewound)"));
      } else {
        // 4b. KEEP
        gitDiscard(checkpoint); // Drop the stash, we are keeping the new state
        console.log(chalk.green("   ✓ Changes accepted."));
      }
    }
  }

  if (parsed.instructions) {
    console.log("\n📌 How to Run:");
    parsed.instructions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }

  console.log("\n✅ Done\n");
}

console.log("\n👋 Goodbye!\n");
