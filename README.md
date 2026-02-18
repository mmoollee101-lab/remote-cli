# Claude Code Telegram Remote Controller

A Telegram bot that bridges your phone to Claude Code CLI running on your PC.

```
[Phone (Telegram)] <---> [Telegram API] <---> [Node.js Bot Server (PC)] <---> [Claude Code CLI]
```

## Features

- **Remote Control**: Send prompts to Claude Code from Telegram on your phone
- **Session Management**: Maintain conversation context with session IDs
- **File Operations**: Browse and read files in your working directory
- **Security**: Only authorized Telegram users can access the bot
- **Long Message Handling**: Auto-splits messages exceeding Telegram's 4096 character limit

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot and get your user ID |
| `/new` | Start a new session |
| `/status` | Show current status (session ID, working directory) |
| `/setdir <path>` | Change working directory |
| `/cancel` | Cancel the current running task |
| `/files` | List files in current directory |
| `/read <file>` | Read and send file contents |
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

## License

MIT
