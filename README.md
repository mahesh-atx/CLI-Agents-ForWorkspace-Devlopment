# CLI-Agents-ForWorkspace-Development

**DevAI** — An autonomous CLI-based AI software engineer that understands your codebase, plans changes, writes code, and auto-fixes errors.

## Features

- **Smart Context Selection** — Automatically reads and prioritizes relevant project files
- **Multi-Model Support** — Works with multiple AI models via configurable API clients
- **Conversation Memory** — Remembers context across multi-turn interactions
- **Image Analysis** — Supports multimodal inputs for UI/screenshot analysis
- **Surgical Patching** — Applies search/replace edits instead of overwriting entire files
- **Self-Debugger Loop** — Automatically runs build/test, captures errors, and fixes them autonomously
- **Project Detection** — Auto-detects React, Express, Node, Python, and static web projects

## Quick Start

```bash
npm install
node devai.js
```

## Commands

| Command        | Description                                          |
| -------------- | ---------------------------------------------------- |
| `/build`       | Run build/test and auto-fix any errors               |
| `/build <cmd>` | Set a custom build command (e.g., `/build npm test`) |
| `undo` / `n`   | Revert the last AI edit instantly (Git Rollback)     |
| `exit`         | Quit DevAI                                           |

## Safety Features: Git Rollback 🛡️

DevAI now performs a **Safety Checkpoint** before every file edit.

1.  It snapshots your uncommitted changes using `git stash`.
2.  It applies the AI's changes.
3.  It asks: **"Review changes. Keep them? (y/undo)"**

- **Type `y`**: Keeps the changes.
- **Type `undo`**: Instantly wipes the AI's changes and restores your exact previous state.

## Recent Updates

- **Llama 3.1 Support**: Added Llama 3.1 70B & 405B models via NVIDIA NIM.
- **Smart Context**: Optimized to reduce token usage and improve speed.
- **JSON Recovery**: Auto-fixes truncated responses for large projects.
- **UI Polish**: Added loading spinners and hidden code blocks for cleaner output.
- **Tech Stack Enforcement**: Defaults to Modern React/Tailwind unless specified otherwise.

## How It Works

1. Select an AI model
2. Point to your project folder
3. Describe what you want built or changed
4. DevAI plans, codes, and patches your files
5. Use `/build` to auto-test and fix errors

## License

MIT
