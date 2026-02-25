# Claude Code Telegram Remote Controller

A Telegram bot that gives you **full remote control** of Claude Code CLI from your phone — no need to be at your PC.

```
[Phone (Telegram)] <---> [Telegram API] <---> [Node.js Bot Server (PC)] <---> [Claude Code SDK]
```

## Why This Over Claude Code Remote Control?

Anthropic's official [Remote Control](https://code.claude.com/docs/en/remote-control) (Feb 2026) lets you continue an existing terminal session from your phone. This project goes further:

| | **Claude Code Remote Control** | **This Bot** |
|---|---|---|
| Start sessions remotely | No — must start at PC first | **Yes — fully remote** |
| Always-on | No — terminal must stay open | **Yes — runs as tray app 24/7** |
| Send photos/files | No | **Yes — via Telegram** |
| Custom commands | No | **Yes — /plan, /lock, /setdir, etc.** |
| Push notifications | No | **Yes — Telegram push** |
| Plan mode feedback | Basic | **Full — view plan content + text feedback on rejection** |
| Cost | Pro/Max subscription required | **Same subscription, more features** |

**TL;DR**: Remote Control = "continue a session away from your desk." This bot = "start, control, and monitor sessions without ever touching your desk."

## Features

- **Full Remote Control**: Start new sessions, send prompts, and manage files from Telegram
- **Session Management**: Resume previous sessions, detect active CLI sessions, hand off between devices
- **Plan Mode Support**: `/plan` command to force plan mode, view plan content before approval, provide text feedback on rejection
- **Task Statistics**: See turn count, API cost, and duration after every task completion
- **Progress Notifications**: Periodic updates during long-running tasks (every 2 minutes)
- **Security**: Authorized user only + `/lock` PIN-based bot locking
- **Photo/File Upload**: Send screenshots or documents directly to Claude via Telegram
- **Smart Directory Switching**: Natural language directory resolution (Korean supported)
- **File Preview**: HTML preview via Cloudflare tunnel, image/script execution
- **Table Rendering**: Auto-converts markdown tables to monospace code blocks for Telegram
- **Tray App Launcher**: Windows system tray icon with auto-start on boot
- **Network Resilience**: Auto-reconnect with exponential backoff on network drops

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
| `/preview <file>` | Preview HTML/images/scripts |
| `/tunnel` | Manage Cloudflare tunnel (status/start/stop) |
| `/lock <PIN>` | Lock the bot with a PIN |
| `/unlock <PIN>` | Unlock the bot |
| `/restart` | Restart the bot process |
| *any text* | Forward as a prompt to Claude Code |

## Setup

### Prerequisites

- Node.js v18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### 1. Create a Telegram Bot

1. Search for `@BotFather` on Telegram
2. Send `/newbot` and follow the instructions
3. Copy the bot token

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set your bot token:

```
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### 3. Install & Run

```bash
npm install
node bot.js
```

### 4. Get Your User ID

1. Open your bot on Telegram and send `/start`
2. The bot will reply with your user ID
3. Add it to `.env`:

```
AUTHORIZED_USER_ID=your_user_id_here
```

4. Restart the bot

### Windows Tray App (Optional)

Run `setup.bat` or launch `dist\Claude Telegram Bot.exe` for a system tray icon with auto-start support.

## License

MIT
