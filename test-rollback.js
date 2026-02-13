
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Mock chalk
const chalk = {
  gray: (msg) => msg,
  yellow: (msg) => msg,
  green: (msg) => msg,
  red: (msg) => msg,
};

// --- COPY OF GIT FUNCTIONS FROM DEVAI.JS ---

function gitCheckpoint() {
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  } catch {
    return null; 
  }

  try {
    const status = execSync("git status --porcelain").toString().trim();
    if (!status) return "clean"; 

    console.log(" 💾 Creating safety checkpoint...");
    execSync('git stash push --include-untracked -m "DevAI_Auto_Checkpoint"');
    execSync('git stash apply'); 
    return "stashed";
  } catch (e) {
    console.log("⚠️  Git checkpoint failed: " + e.message);
    return null;
  }
}

function gitRestore(checkpointType) {
  try {
    console.log(" ↺ Rolling back changes...");
    execSync("git reset --hard HEAD", { stdio: "ignore" });
    execSync("git clean -fd", { stdio: "ignore" }); 

    if (checkpointType === "stashed") {
      execSync("git stash pop", { stdio: "ignore" }); 
    }
    console.log(" ✅ Rollback complete.");
  } catch (e) {
    console.log("❌ Rollback failed: " + e.message);
  }
}

// --- TEST LOGIC ---

try {
  // Create temp dir
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "devai-test-"));
  console.log(`Using temp dir: ${tempDir}`);
  process.chdir(tempDir);

  // 1. Setup Git
  execSync("git init");
  execSync('git config user.email "test@test.com"');
  execSync('git config user.name "Test User"');
  
  // 2. Create initial state
  fs.writeFileSync("test.txt", "Initial Content");
  execSync("git add test.txt");
  execSync('git commit -m "Initial commit"');
  
  // 3. Make it dirty (uncommitted change)
  // The user says "Dirty state (uncommitted code) to the stack"
  // So we simulate working on something
  fs.writeFileSync("test.txt", "Initial + Work in Progress");
  console.log("State before AI: Dirty (WIP)");

  // 4. CHECKPOINT
  const checkpoint = gitCheckpoint();
  
  // 5. AI Makes Changes (Destructive!)
  fs.writeFileSync("test.txt", "AI RUINED THIS FILE");
  console.log("AI modified file to: " + fs.readFileSync("test.txt", "utf8"));

  // 6. ROLLBACK
  gitRestore(checkpoint);
  
  // 7. Verify
  const content = fs.readFileSync("test.txt", "utf8");
  console.log("Restored content: " + content);
  
  if (content === "Initial + Work in Progress") {
    console.log("\n✅ TEST PASSED: Setup restored correctly!");
  } else {
    console.error("\n❌ TEST FAILED: Content mismatch.");
  }

} catch (e) {
  console.error(e);
}
