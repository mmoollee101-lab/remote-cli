---
name: verify-process
description: |
  Verify process management patterns in the Telegram bot.
  Checks child process lifecycle, signal handling, concurrency control,
  and resource cleanup.

  Triggers: verify process, check process, 프로세스 검증, 프로세스 관리 검사
argument-hint: ""
user-invocable: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Verify Process Skill

> Verify child process lifecycle, signal handling, and concurrency control in bot.js

## Purpose

Ensure that the Telegram bot properly manages child processes:
- Claude CLI process spawned correctly with proper arguments
- Process handles cleaned up on completion, error, and cancellation
- Signal handlers (SIGINT, SIGTERM) properly terminate child processes
- Concurrent request prevention works correctly
- Typing indicator cleaned up in all code paths

## When to Run

- After modifying `runClaude()` function
- After changing process spawn arguments or options
- After modifying `/cancel` handler or signal handlers
- After changing the message processing flow
- Before PR submission

## Related Files

| File | Role |
|------|------|
| `bot.js` | Main bot source — process management logic |
| `package.json` | Node.js project config |

## Workflow

### Check 1: Process spawn uses argument array (not shell)

`spawn` must use argument array form, not `shell: true`, to prevent command injection.

**Detection:**
```bash
grep -A10 "spawn(" bot.js
```

**PASS:** `spawn(command, args, options)` form used; no `shell: true` in options
**FAIL:** `shell: true` present or command string used instead of array

### Check 2: currentProcess reference cleared on all exit paths

`currentProcess` must be set to `null` in both `close` and `error` event handlers.

**Detection:**
```bash
grep -n "currentProcess" bot.js
```

**PASS:** `currentProcess = null` present in both `proc.on("close")` and `proc.on("error")`
**FAIL:** Missing cleanup in any exit path

### Check 3: Concurrent request prevention

The message handler must check `isProcessing` flag before starting a new Claude process, and reset it in `finally` block.

**Detection:**
```bash
# Check flag set before processing
grep -n "isProcessing" bot.js
```

**PASS:** `isProcessing` checked at start, set to `true` before `runClaude`, reset to `false` in `finally`
**FAIL:** Missing check, set, or reset

### Check 4: Signal handlers terminate child process

Both `SIGINT` and `SIGTERM` handlers must kill `currentProcess` if it exists and stop bot polling.

**Detection:**
```bash
grep -A5 "SIGINT\|SIGTERM" bot.js
```

**PASS:** Both handlers check `currentProcess` and call `.kill("SIGTERM")`, then `bot.stopPolling()` and `process.exit(0)`
**FAIL:** Missing child process termination or bot polling stop

### Check 5: /cancel handler properly resets state

The `/cancel` command must kill current process, clear `currentProcess`, and reset `isProcessing`.

**Detection:**
```bash
grep -A10 "\/cancel" bot.js
```

**PASS:** Handler kills process, sets `currentProcess = null`, sets `isProcessing = false`
**FAIL:** Missing any state reset

### Check 6: Typing indicator cleanup

`typingInterval` must be cleared in `finally` block to prevent indefinite typing indicators.

**Detection:**
```bash
grep -n "typingInterval\|clearInterval" bot.js
```

**PASS:** `clearInterval(typingInterval)` in `finally` block
**FAIL:** Missing cleanup or cleanup outside `finally`

### Check 7: stdin closed after spawn

`proc.stdin.end()` must be called to signal no input, preventing process hang.

**Detection:**
```bash
grep -n "stdin.end\|stdin.write" bot.js
```

**PASS:** `proc.stdin.end()` called after spawn
**FAIL:** Missing stdin closure

### Check 8: Windows compatibility for spawn

Process spawn must handle Windows `.cmd` extension for Claude CLI.

**Detection:**
```bash
grep -n "win32\|\.cmd" bot.js
```

**PASS:** Platform check with `process.platform === "win32"` and conditional `.cmd` extension
**FAIL:** Missing Windows compatibility

## Output Format

```
## Process Management Verification Report

| # | Check | Status | Detail |
|---|-------|--------|--------|
| 1 | Spawn uses arg array | PASS/FAIL | |
| 2 | currentProcess cleanup | PASS/FAIL | N/N exit paths covered |
| 3 | Concurrency prevention | PASS/FAIL | |
| 4 | Signal handlers | PASS/FAIL | SIGINT: ok, SIGTERM: ok |
| 5 | /cancel state reset | PASS/FAIL | |
| 6 | Typing indicator cleanup | PASS/FAIL | |
| 7 | stdin closed | PASS/FAIL | |
| 8 | Windows compatibility | PASS/FAIL | |

**Overall: PASS/FAIL**
```

## Exceptions

- `windowsHide: true` in spawn options is intentional to prevent console window flash on Windows
- `stdio: ["pipe", "pipe", "pipe"]` is correct — the bot needs to capture both stdout and stderr
- The `SIGTERM` sent to child process (not `SIGKILL`) is intentional to allow graceful shutdown
