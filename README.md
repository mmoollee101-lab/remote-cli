# Claude Code Telegram Remote Controller

A Telegram bot that gives you **full remote control** of Claude Code CLI from your phone — no need to be at your PC.

```
[Phone (Telegram)] <---> [Telegram API] <---> [Node.js Bot Server (PC)] <---> [Claude Code SDK]
```

## Why This Over Claude Code Remote Control?

Anthropic's official [Remote Control](https://code.claude.com/docs/en/remote-control) (Feb 2026) lets you continue a local terminal session from your phone via claude.ai/code or the Claude mobile app. This project takes a different approach:

| | **Claude Code Remote Control** | **This Bot** |
|---|---|---|
| How it works | Browser/app connects to local terminal | Telegram bot runs Claude Code SDK directly |
| Start sessions remotely | Requires `claude remote-control` in terminal first | **Yes — fully remote, no terminal needed** |
| Always-on | No — terminal process must stay open | **Yes — runs as tray app 24/7** |
| Send photos/files from phone | No — text messages only | **Yes — photos & documents via Telegram** |
| Custom commands | No — standard Claude Code interface | **Yes — /plan, /lock, /setdir, /preview, etc.** |
| Push notifications | No — must check the app | **Yes — Telegram push notifications** |
| Plan mode UX | Standard plan mode | **Enhanced — view plan content + text feedback on rejection** |
| File preview | No | **Yes — HTML tunnel, image, script execution** |
| Multi-language | No | **Yes — Korean/English switchable** |
| Multi-device sync | Yes — terminal, browser, mobile in sync | Single Telegram chat |
| Sandboxing | Optional (`--sandbox` flag) | No |
| Plan | Pro/Max | **Same subscription (Max API)** |

**TL;DR**: Remote Control = "continue a running terminal session from your phone." This bot = "start, control, and monitor sessions without ever touching your desk."

## Features

### Core
- **Full Remote Control** — Start new sessions, send prompts, and manage files from Telegram
- **Claude Code SDK Integration** — Directly uses `@anthropic-ai/claude-agent-sdk` for native conversation management
- **Session Management** — Resume previous sessions, detect active CLI sessions, hand off between devices
- **Permission Modes** — Choose between Safe mode (approve each tool) or Full-bypass mode per session

### Plan Mode
- `/plan` command to force plan mode for the next message
- View full plan content before approval
- Approve / Reject with text feedback via inline buttons
- Plan mode auto-resets after task completion

### Task Monitoring
- **Task Statistics** — Turn count, API cost, and duration displayed after every task
- **Progress Notifications** — Periodic updates every 2 minutes during long-running tasks
- **AskUserQuestion Support** — Inline buttons for Claude's interactive questions with custom "Other" text input

### Security
- **Authorized User Only** — Single-user authentication via Telegram user ID
- **PIN Lock/Unlock** — `/lock` and `/unlock` with 2-step PIN confirmation and auto-delete of PIN messages
- **Single Instance Lock** — PID-based lock file prevents duplicate bot processes

### File & Media
- **Photo/Document Upload** — Send screenshots or documents directly to Claude via Telegram
- **Smart Upload Handling** — Waits for caption if photo sent without text, auto-forwards to Claude
- **File Preview** — HTML preview via Cloudflare tunnel, image rendering, script execution (.py, .js, .bat)
- **Screenshot Capture** — PowerShell-based screen capture on demand
- **Upload Cleanup** — Auto-cleans upload directory after forwarding

### UX
- **Multi-Language (i18n)** — Full Korean/English support, switchable via tray menu
- **Smart Directory Switching** — Natural language directory resolution with fuzzy matching (Korean supported)
- **Table Rendering** — Auto-converts markdown tables to monospace code blocks for Telegram
- **Safe Markdown** — Auto-fallback to plain text when Telegram can't parse markdown entities
- **Network Resilience** — Auto-reconnect with exponential backoff on network drops

### Windows Integration
- **System Tray App** — C# launcher with tray icon, context menu, and notifications
- **Auto-Start on Boot** — Toggle Windows startup via tray menu
- **Language Switching** — Change i18n language from tray menu (Korean/English)
- **Graceful Shutdown** — Proper cleanup of child processes and lock files

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot and get your user ID |
| `/new` | Start a new session (detects active CLI sessions) |
| `/resume` | Resume a previous terminal session |
| `/plan` | Force plan mode for the next message |
| `/status` | Show current status (session, directory, mode) |
| `/setdir <path>` | Change working directory (natural language supported) |
| `/cancel` | Cancel the current running task |
| `/files` | List files in current directory |
| `/read <file>` | Read and send file contents |
| `/preview <file>` | Preview HTML/images/scripts via Cloudflare tunnel |
| `/tunnel` | Manage Cloudflare tunnel (status/start/stop) |
| `/lock <PIN>` | Lock the bot with a PIN |
| `/unlock <PIN>` | Unlock the bot |
| `/restart` | Restart the bot process |
| *any text* | Forward as a prompt to Claude Code |
| *photo/file* | Upload and forward to Claude as context |

## Setup

### Prerequisites

- Node.js v18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 1. Create a Telegram Bot

1. Search for `@BotFather` on Telegram
2. Send `/newbot` and follow the instructions
3. Copy the bot token

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
AUTHORIZED_USER_ID=your_user_id_here
COMPUTER_NAME=MyPC
```

> **Tip**: Run the bot first without `AUTHORIZED_USER_ID`, send `/start` in Telegram, and the bot will show your user ID.

### 3. Install & Run

```bash
npm install
node bot.js
```

### 4. Windows Tray App (Optional)

Run `setup.bat` for automated setup, or launch `dist\ClaudeTelegramBot.exe` directly. The tray app provides:

- System tray icon with context menu
- Auto-start on Windows boot (toggle in menu)
- Language switching (Korean/English)
- Open log file
- Restart / Quit controls

## Architecture

```
bot.js              — Main bot: Telegram ↔ Claude Code SDK bridge
launcher.cs         — Windows tray launcher (C# WinForms)
setup.bat           — First-time setup script
.env                — Configuration (tokens, user ID, computer name)
bot-state.json      — Persisted state (working directory, language, session)
bot.lock            — Single-instance PID lock
uploads/            — Temporary upload directory (auto-cleaned)
dist/               — Built tray app executable
```

## Tech Stack

- **[Claude Code SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)** — Claude Code conversation engine
- **[node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)** — Telegram Bot API client
- **[Express](https://expressjs.com/)** — Local preview server
- **[Cloudflared](https://github.com/nicedoc/cloudflared)** — Cloudflare tunnel for HTML preview
- **[dotenv](https://github.com/motdotla/dotenv)** — Environment variable management

## GitHub Releases

Pre-built Windows executables are available on the [Releases](../../releases) page, built automatically via GitHub Actions.

## License

MIT
