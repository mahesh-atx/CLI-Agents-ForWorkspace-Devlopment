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
| `exit`         | Quit DevAI                                           |

## How It Works

1. Select an AI model
2. Point to your project folder
3. Describe what you want built or changed
4. DevAI plans, codes, and patches your files
5. Use `/build` to auto-test and fix errors

## License

MIT
