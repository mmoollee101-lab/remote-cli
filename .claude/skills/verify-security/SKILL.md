---
name: verify-security
description: |
  Verify security patterns in the Telegram bot.
  Checks authentication, path traversal prevention, environment variable validation,
  and input sanitization.

  Triggers: verify security, check security, 보안 검증, 인증 검사
argument-hint: ""
user-invocable: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Verify Security Skill

> Verify authentication, path traversal prevention, and input validation patterns in bot.js

## Purpose

Ensure that the Telegram bot maintains proper security controls:
- User authentication gating on all command handlers
- Path traversal prevention on file access operations
- Environment variable validation at startup
- Input sanitization for user-supplied parameters

## When to Run

- After modifying `bot.js` command handlers
- After adding new bot commands or message handlers
- After changing authentication logic or environment variable handling
- Before PR submission

## Related Files

| File | Role |
|------|------|
| `bot.js` | Main bot source — all security patterns live here |
| `package.json` | Dependencies (node-telegram-bot-api, dotenv) |
| `.env` | Environment variables (TELEGRAM_BOT_TOKEN, AUTHORIZED_USER_ID) |

## Workflow

### Check 1: Authentication gating on all command handlers

Every `bot.onText` handler (except `/start`) must call `isAuthorized(msg)` and return early if false.

**Detection:**
```bash
# Find all bot.onText handlers
grep -n "bot.onText" bot.js

# For each handler (except /start), verify isAuthorized check exists
grep -A5 "bot.onText" bot.js | grep "isAuthorized"
```

**PASS:** Every command handler (excluding `/start`) contains `if (!isAuthorized(msg)) return;`
**FAIL:** Any command handler missing the authorization check

### Check 2: Authentication on general message handler

The `bot.on("message")` handler must check `isAuthorized(msg)`.

**Detection:**
```bash
grep -A10 'bot.on("message"' bot.js | grep "isAuthorized"
```

**PASS:** `isAuthorized` check present in message handler
**FAIL:** Missing authorization in message handler

### Check 3: Path traversal prevention on /read command

The `/read` handler must validate that resolved file paths stay within `workingDir`.

**Detection:**
```bash
grep -A20 '\/read' bot.js | grep "startsWith"
```

**PASS:** `filePath.startsWith(workingDir)` check exists before file read
**FAIL:** Missing path traversal prevention

### Check 4: Environment variable validation at startup

`TELEGRAM_BOT_TOKEN` must be validated before bot initialization. `AUTHORIZED_USER_ID` should have a warning when unset.

**Detection:**
```bash
# Token validation
grep -n "BOT_TOKEN" bot.js | grep -E "(process\.exit|Error)"

# User ID warning
grep -n "AUTHORIZED_USER_ID" bot.js | grep "warn"
```

**PASS:** Token validated with `process.exit(1)` on missing; User ID has warning
**FAIL:** Missing validation or missing warning

### Check 5: File size limit on /read command

The `/read` handler must check file size before reading to prevent memory exhaustion.

**Detection:**
```bash
grep -A30 '\/read' bot.js | grep "stat.size"
```

**PASS:** File size check exists (currently 1MB limit)
**FAIL:** Missing file size validation

### Check 6: No raw user input in shell commands

User-supplied text must never be interpolated into shell commands (command injection prevention).

**Detection:**
```bash
# Check that spawn args don't contain unsanitized user input
grep -n "spawn" bot.js
# Verify prompt is passed as argument array element, not interpolated into command string
```

**PASS:** `spawn` uses argument array (not shell string interpolation)
**FAIL:** User input concatenated into shell command string

## Output Format

```
## Security Verification Report

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1 | Auth on command handlers | PASS/FAIL | N/N handlers covered |
| 2 | Auth on message handler | PASS/FAIL | |
| 3 | Path traversal prevention | PASS/FAIL | |
| 4 | Env variable validation | PASS/FAIL | |
| 5 | File size limit | PASS/FAIL | |
| 6 | No command injection | PASS/FAIL | |

**Overall: PASS/FAIL**
```

## Exceptions

- `/start` handler intentionally allows unauthenticated access (for user ID discovery)
- `callback_query` handler does not check `isAuthorized` because it only processes inline keyboard responses tied to existing authorized conversations
- Console log output of truncated prompts (`substring(0, 50)`) is not a security concern as it's server-side only
