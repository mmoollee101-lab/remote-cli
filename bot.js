require("dotenv").config();
delete process.env.CLAUDECODE; // SDK가 중첩 세션 감지하지 않도록
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec, execFile } = require("child_process");
const https = require("https");
const express = require("express");
const crypto = require("crypto");
const cron = require("node-cron");
const CONFIG = require("./config");
const { STRINGS, createT } = require("./i18n");
const {
  convertMarkdownTables, createTelegraphPage, isInsideWorkingDir,
  resolveFilePath, registerPath, lookupPath, extractFilePaths,
  buildFileButtons, extractNumberedOptions, buildOptionButtons,
  resolveDirectory,
} = require("./utils");

// ─── 중복 실행 방지 ─────────────────────────────────────────────
const LOCK_FILE = path.join(process.cwd(), "bot.lock");

function acquireLock() {
  try {
    // 기존 lock 파일이 있으면 해당 PID가 살아있는지 확인
    if (fs.existsSync(LOCK_FILE)) {
      const oldPid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      if (oldPid) {
        try {
          process.kill(oldPid, 0); // 프로세스 존재 확인 (신호 안 보냄)
          console.error(`[ERROR] 이미 실행 중인 봇이 있습니다 (PID: ${oldPid}). 종료합니다.`);
          process.exit(1);
        } catch {
          // 프로세스가 없으면 stale lock — 무시하고 계속
        }
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
  } catch (err) {
    console.error(`[WARN] Lock 파일 생성 실패: ${err.message}`);
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      if (pid === process.pid) fs.unlinkSync(LOCK_FILE);
    }
  } catch {}
}

acquireLock();

// ─── 파일 로깅 ──────────────────────────────────────────────────
const LOG_FILE = path.join(process.cwd(), "bot.log");

// 로그 파일 초기화 (최대 1MB 넘으면 리셋)
try {
  if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > CONFIG.LOG_MAX_SIZE) {
    fs.writeFileSync(LOG_FILE, "");
  }
} catch {}

function writeLogLine(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  writeLogLine(line);
}

function logError(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.error(line);
  writeLogLine(line);
}

// ─── 설정 가이드 출력 ────────────────────────────────────────────
function printSetupGuide() {
  console.log(`
  Claude Code Telegram Remote Controller
  ───────────────────────────────────────

  1. Telegram에서 @BotFather 검색
  2. /newbot 명령으로 봇 생성
  3. 발급받은 토큰을 .env에 설정:
     TELEGRAM_BOT_TOKEN=your_token_here
  4. 봇 실행 후 텔레그램에서 /start 전송
  5. 콘솔에 출력된 유저 ID를 .env에 설정:
     AUTHORIZED_USER_ID=your_id_here
  6. 봇 재실행하면 준비 완료!
`);
}

printSetupGuide();

// ─── 환경 변수 확인 ──────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_USER_ID = process.env.AUTHORIZED_USER_ID && /^\d+$/.test(process.env.AUTHORIZED_USER_ID.trim())
  ? Number(process.env.AUTHORIZED_USER_ID.trim())
  : null;

const COMPUTER_NAME = process.env.COMPUTER_NAME || os.hostname();

// ─── i18n ────────────────────────────────────────────────────────
let currentLang = "ko"; // loadState()에서 덮어씀

function getLocale() {
  return currentLang === "ko" ? "ko-KR" : "en-US";
}

const t = createT(() => currentLang);

if (!BOT_TOKEN || BOT_TOKEN === "your_bot_token_here") {
  logError("[ERROR] TELEGRAM_BOT_TOKEN이 설정되지 않았습니다. .env 파일을 확인하세요.");
  process.exit(2); // exit code 2 = 설정 미비
}

if (!AUTHORIZED_USER_ID) {
  log("[WARN] AUTHORIZED_USER_ID가 설정되지 않았습니다. /start로 유저 ID를 확인한 뒤 .env에 설정하세요.");
}

// ─── 봇 초기화 ───────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function setCommands() {
  bot.setMyCommands([
    { command: "start", description: t("cmd_start") },
    { command: "new", description: t("cmd_new") },
    { command: "status", description: t("cmd_status") },
    { command: "setdir", description: t("cmd_setdir") },
    { command: "cancel", description: t("cmd_cancel") },
    { command: "files", description: t("cmd_files") },
    { command: "read", description: t("cmd_read") },
    { command: "preview", description: t("cmd_preview") },
    { command: "tunnel", description: t("cmd_tunnel") },
    { command: "resume", description: t("cmd_resume") },
    { command: "restart", description: t("cmd_restart") },
    { command: "plan", description: t("cmd_plan") },
    { command: "lock", description: t("cmd_lock") },
    { command: "unlock", description: t("cmd_unlock") },
    { command: "setbudget", description: t("cmd_setbudget") },
    { command: "effort", description: t("cmd_effort") },
    { command: "tree", description: t("cmd_tree") },
    { command: "delete", description: t("cmd_delete") },
    { command: "copy", description: t("cmd_copy") },
    { command: "rename", description: t("cmd_rename") },
    { command: "move", description: t("cmd_move") },
    { command: "revert", description: t("cmd_revert") },
    { command: "search", description: t("cmd_search") },
    { command: "grep", description: t("cmd_grep") },
    { command: "webhook", description: t("cmd_webhook") },
    { command: "schedule", description: t("cmd_schedule") },
    { command: "schedules", description: t("cmd_schedules") },
    { command: "unschedule", description: t("cmd_unschedule") },
    { command: "teleport", description: t("cmd_teleport") },
    { command: "verbose", description: t("cmd_verbose") },
  ]);
}
setCommands();

log("[INFO] 봇이 시작되었습니다. 텔레그램에서 메시지를 보내보세요.");

// 시작 알림은 초기화 완료 후 sendStartupMessage()에서 전송

// ─── 상태 영속화 ─────────────────────────────────────────────────
const STATE_FILE = path.join(process.cwd(), "bot-state.json");

function serializeCronJobs() {
  return [...cronJobs.entries()].map(([id, j]) => ({
    id, expression: j.expression, command: j.command,
  }));
}

function restoreCronJobs(arr) {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    try {
      const job = cron.schedule(item.expression, () => {
        log(`[CRON] 실행: ${item.command}`);
        exec(item.command, { cwd: workingDir, timeout: 60000 }, async (err, stdout) => {
          const result = err ? `❌ ${err.message}` : (stdout || "(no output)");
          if (AUTHORIZED_USER_ID) {
            await safeSend(AUTHORIZED_USER_ID, t("cron_result", { id: item.id, command: item.command, result: result.substring(0, 1000) }), { parse_mode: "Markdown" });
          }
        });
      });
      cronJobs.set(item.id, { expression: item.expression, command: item.command, job });
      cronCounter = Math.max(cronCounter, parseInt(item.id) || 0);
    } catch {}
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      if (data.lang && STRINGS[data.lang]) currentLang = data.lang;
      // Phase 1: 새 필드 로드 (없으면 기본값 유지)
      if (data.budget != null) currentBudget = data.budget;
      if (data.effort) currentEffort = data.effort;
      if (data.verbosity != null) currentVerbosity = data.verbosity;
      if (data.pinHash) { pinHash = data.pinHash; isLocked = data.isLocked || false; }
      if (data.webhookToken) webhookToken = data.webhookToken;
      if (data.cronJobs) restoreCronJobs(data.cronJobs);
      if (data.workingDir && fs.existsSync(data.workingDir)) {
        return data.workingDir;
      }
    }
  } catch {}
  return null;
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      workingDir, lang: currentLang,
      pinHash, isLocked,
      budget: currentBudget,
      effort: currentEffort,
      verbosity: currentVerbosity,
      webhookToken,
      cronJobs: serializeCronJobs(),
    }, null, 2));
  } catch {}
}

// ─── 상태 관리 ───────────────────────────────────────────────────
let sessionId = null;
const savedDir = loadState();
let workingDir = savedDir || process.cwd();
let currentAbortController = null;
let isProcessing = false;
let skipPermissions = false;
let needsPermissionChoice = true;
let pendingMessage = null;
let pendingSdkAsk = null;
let pendingResumeSessions = null;
let pendingCommand = null; // { type: 'setdir'|'read'|'preview' }
let forcePlanMode = false;
let isLocked = false;
let pinHash = null; // SHA-256 해시 (PIN 영속화)
let currentBudget = CONFIG.DEFAULT_BUDGET_USD;  // /setbudget으로 변경
let currentEffort = CONFIG.DEFAULT_EFFORT;       // /effort로 변경
let currentVerbosity = CONFIG.VERBOSITY_NORMAL;  // /verbose로 변경
let webhookServer = null;                        // Phase 4 webhook Express
let webhookToken = null;                         // Phase 4 인증 토큰
let cronJobs = new Map();                        // id → { expression, command, job }
let cronCounter = 0;

function hashPin(pin) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}
let pendingPlanRejection = null;
let pendingLockAction = null; // { type: 'lock'|'unlock' }

// ─── Preview/Tunnel 상태 ────────────────────────────────────────
const PREVIEW_PORT = CONFIG.PREVIEW_PORT;
let expressServer = null;
let tunnelProcess = null;
let tunnelUrl = null;
let previewChildPid = null; // GUI 미리보기 프로세스 PID (종료 버튼용)

// ─── 메시지 큐 ──────────────────────────────────────────────────
const messageQueue = [];

// ─── SDK 로딩 ───────────────────────────────────────────────────
let sdkQuery = null;

async function loadSDK() {
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    sdkQuery = sdk.query;
    log("[SDK] Claude Agent SDK 로드 완료");
  } catch (err) {
    logError(`[SDK] SDK 로드 실패: ${err.message}`);
    process.exit(1);
  }
}

// ─── 인증 미들웨어 ───────────────────────────────────────────────
function isAuthorized(msg) {
  const userId = msg.from.id;
  if (!AUTHORIZED_USER_ID) return false;
  return userId === AUTHORIZED_USER_ID;
}

// ─── 메시지 분할 전송 ────────────────────────────────────────────
const MAX_MSG_LENGTH = CONFIG.MAX_MSG_LENGTH;

async function safeSend(chatId, text, options = {}) {
  try {
    await bot.sendMessage(chatId, text, options);
  } catch (err) {
    if (err.message && err.message.includes("can't parse entities")) {
      // 마크다운 파싱 실패 → 일반 텍스트로 재전송
      const fallback = { ...options };
      delete fallback.parse_mode;
      await bot.sendMessage(chatId, text, fallback);
    } else {
      throw err;
    }
  }
}


async function sendLongMessage(chatId, text, options = {}) {
  if (!text || text.length === 0) {
    await safeSend(chatId, t("empty_response"), options);
    return;
  }

  // 마크다운 테이블을 코드블록으로 변환
  if (options.parse_mode === "Markdown") {
    text = convertMarkdownTables(text);
  }

  if (text.length <= MAX_MSG_LENGTH) {
    await safeSend(chatId, text, options);
    return;
  }

  // 매우 긴 응답 → Telegraph 페이지 생성 시도
  if (text.length > MAX_MSG_LENGTH * 2) {
    try {
      const url = await createTelegraphPage("Claude Response", text);
      if (url) {
        await safeSend(chatId, t("response_telegraph", { url }));
        return;
      }
    } catch {}
    // Telegraph 실패 시 기존 분할 방식으로 폴백
  }

  // 긴 메시지를 분할
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // 줄바꿈 기준으로 자르기
    let cutIndex = remaining.lastIndexOf("\n", MAX_MSG_LENGTH);
    if (cutIndex === -1 || cutIndex < MAX_MSG_LENGTH / 2) {
      cutIndex = MAX_MSG_LENGTH;
    }

    chunks.push(remaining.substring(0, cutIndex));
    remaining = remaining.substring(cutIndex);
  }

  for (let i = 0; i < chunks.length; i++) {
    const header =
      chunks.length > 1 ? `[${i + 1}/${chunks.length}]\n` : "";
    await safeSend(chatId, header + chunks[i], options);
  }
}

// ─── 세션 탐색 (터미널 세션 이어받기) ─────────────────────────────

function encodeProjectPath(dir) {
  return dir.replace(/[^a-zA-Z0-9]/g, "-");
}

// JSONL에서 마지막 유저 메시지 추출 (파일 끝 8KB 읽기)
function extractLastUserMessage(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    const fd = fs.openSync(fullPath, "r");
    const readSize = Math.min(8192, stat.size);
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);
    const chunk = buf.toString("utf-8");
    const lines = chunk.split("\n").reverse();
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "user" && obj.message?.role === "user") {
          const content = obj.message.content;
          if (typeof content === "string") {
            return content.substring(0, 60);
          }
        }
      } catch {}
    }
  } catch {}
  return "";
}

// 특정 프로젝트 디렉토리에서 세션 목록 가져오기
function getSessionsFromProjectDir(projectDir, dirLabel) {
  try {
    return fs.readdirSync(projectDir)
      .filter((f) => /^[0-9a-f]{8}-/.test(f) && f.endsWith(".jsonl"))
      .map((f) => {
        const fullPath = path.join(projectDir, f);
        const stat = fs.statSync(fullPath);
        const id = path.basename(f, ".jsonl");
        const preview = extractLastUserMessage(fullPath);
        const active = (Date.now() - stat.mtime.getTime()) < 120000; // 2분 이내 수정 → 활성
        return { id, mtime: stat.mtime, preview, active, dirLabel };
      });
  } catch {
    return [];
  }
}

function findRecentSessions(dir, limit = 5) {
  const projectsBase = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsBase)) return [];

  const encoded = encodeProjectPath(dir);
  const projectDir = path.join(projectsBase, encoded);

  // 1. 현재 workingDir의 세션
  let sessions = [];
  if (fs.existsSync(projectDir)) {
    sessions = getSessionsFromProjectDir(projectDir, null);
  }

  // 2. 다른 프로젝트 중 최근 수정된 세션도 포함 (최근 24시간)
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(projectsBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const otherDir = path.join(projectsBase, entry.name);
      if (otherDir === projectDir) continue; // 이미 검색함

      // 디렉토리 이름에서 경로 복원 (대략적)
      const dirName = entry.name.replace(/^[A-Za-z]-/, (m) => m[0] + ":\\").replace(/-/g, "\\");
      const folderName = path.basename(dirName);

      for (const f of fs.readdirSync(otherDir)) {
        if (!/^[0-9a-f]{8}-/.test(f) || !f.endsWith(".jsonl")) continue;
        try {
          const stat = fs.statSync(path.join(otherDir, f));
          if (stat.mtime.getTime() > cutoff) {
            sessions.push(...getSessionsFromProjectDir(otherDir, folderName));
            break; // 이 디렉토리는 하나만 확인하면 충분
          }
        } catch {}
      }
    }
  } catch {}

  return sessions
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

function findActiveSessions(dir) {
  return findRecentSessions(dir, 10).filter(s => s.active);
}

// ─── AskUserQuestion → 텔레그램 전달 ─────────────────────────────
function askViaTelegram(question, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error("작업이 취소되었습니다."));
      return;
    }

    const onAbort = () => {
      pendingSdkAsk = null;
      reject(new Error("작업이 취소되었습니다."));
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // 선택지를 인라인 키보드로 변환 (2열 배치) + "기타" 버튼
    const buttons = question.options.map((opt, i) => ({
      text: opt.label,
      callback_data: `sdk_ask_${i}`,
    }));
    buttons.push({ text: t("ask_text_input"), callback_data: "sdk_ask_other" });
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2));
    }

    pendingSdkAsk = {
      resolve: (answer) => {
        pendingSdkAsk = null;
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(answer);
      },
      question: question.question,
      options: question.options,
    };

    log(`[ASK] 텔레그램으로 질문 전송: ${question.question}`);

    bot.sendMessage(AUTHORIZED_USER_ID, `❓ ${question.question}`, {
      reply_markup: { inline_keyboard: rows },
    }).catch((err) => {
      pendingSdkAsk = null;
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

// ─── 도구 아이콘 ────────────────────────────────────────────────
const TOOL_ICONS = {
  Read: "📖", Edit: "✏️", Write: "📝", Bash: "💻",
  Glob: "🔍", Grep: "🔎", WebSearch: "🌐", WebFetch: "🌐",
  Task: "📋", AskUserQuestion: "❓", NotebookEdit: "📓",
  EnterPlanMode: "📝", ExitPlanMode: "📋",
};

// ─── canUseTool 콜백 ─────────────────────────────────────────────
const READ_ONLY_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  "Task", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList",
]);

let pendingToolApproval = null;

function askToolApproval(toolName, detail, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pendingToolApproval = null;
      reject(new Error("취소됨"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    pendingToolApproval = {
      resolve: (allowed) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        pendingToolApproval = null;
        resolve(allowed);
      },
      isPlan: toolName === "ExitPlanMode",
    };

    const isPlan = toolName === "ExitPlanMode";
    const icon = isPlan ? "📋" : (TOOL_ICONS[toolName] || "🔧");
    let text = isPlan
      ? t("plan_approval_title", { detail })
      : t("tool_approval_title", { icon, name: toolName });
    if (!isPlan && detail) text += `\n${detail}`;

    const buttons = isPlan
      ? [
          { text: t("btn_plan_approve"), callback_data: "tool_approve_yes" },
          { text: t("btn_plan_reject"), callback_data: "tool_approve_no" },
        ]
      : [
          { text: t("btn_tool_approve"), callback_data: "tool_approve_yes" },
          { text: t("btn_tool_reject"), callback_data: "tool_approve_no" },
        ];

    bot.sendMessage(AUTHORIZED_USER_ID, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [buttons],
      },
    }).catch((err) => {
      pendingToolApproval = null;
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

function getToolDetail(toolName, input) {
  if (toolName === "Write" || toolName === "Edit" || toolName === "Read")
    return input.file_path ? `📄 ${input.file_path}` : "";
  if (toolName === "Bash")
    return input.command ? `\`${input.command.slice(0, 100)}\`` : "";
  if (toolName === "Glob")
    return input.pattern || "";
  if (toolName === "Grep")
    return input.pattern || "";
  return "";
}

function findLatestPlanFile() {
  const plansDir = path.join(os.homedir(), ".claude", "plans");
  if (!fs.existsSync(plansDir)) return null;
  try {
    const files = fs.readdirSync(plansDir)
      .filter(f => f.endsWith(".md"))
      .map(f => ({
        name: f,
        fullPath: path.join(plansDir, f),
        mtime: fs.statSync(path.join(plansDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return null;
    // 최근 60초 이내 수정된 파일만
    if (Date.now() - files[0].mtime > 60000) return null;
    return files[0].fullPath;
  } catch {
    return null;
  }
}

async function handleToolPermission(toolName, input, options) {
  const { signal } = options;

  // AskUserQuestion → 텔레그램으로 전달하고 응답 대기
  if (toolName === "AskUserQuestion" && input.questions && input.questions.length > 0) {
    try {
      const q = input.questions[0];
      const answer = await askViaTelegram(q, signal);

      const answers = {};
      answers[q.question] = answer;

      log(`[ASK] 사용자 선택: ${answer}`);

      return {
        behavior: "allow",
        updatedInput: { ...input, answers },
      };
    } catch (err) {
      return {
        behavior: "deny",
        message: err.message || "사용자가 질문을 취소했습니다.",
      };
    }
  }

  // EnterPlanMode → 항상 허용 (계획 수립 시작)
  if (toolName === "EnterPlanMode") {
    log("[PLAN] 플랜 모드 진입");
    return { behavior: "allow", updatedInput: input };
  }

  // ExitPlanMode → 플랜 파일 내용 전송 후 승인 요청
  if (toolName === "ExitPlanMode") {
    // 플랜 파일 내용 전송
    const planFile = findLatestPlanFile();
    if (planFile && AUTHORIZED_USER_ID) {
      try {
        const planContent = fs.readFileSync(planFile, "utf-8");
        if (planContent.trim()) {
          await sendLongMessage(AUTHORIZED_USER_ID, t("plan_content_header", { content: planContent }), {
            parse_mode: "Markdown",
          });
        }
      } catch (err) {
        log(`[PLAN] 플랜 파일 읽기 실패: ${err.message}`);
      }
    }

    if (skipPermissions) {
      log("[PLAN] 플랜 모드 종료 (자동 승인)");
      return { behavior: "allow", updatedInput: input };
    }
    try {
      log("[PLAN] 플랜 모드 종료 승인 요청");
      const result = await askToolApproval("ExitPlanMode", t("plan_approve_question"), signal);
      if (result === true) {
        log("[PLAN] 계획 승인됨 → 구현 시작");
        return { behavior: "allow", updatedInput: input };
      } else if (result && result.feedback) {
        log(`[PLAN] 계획 거부됨 — 피드백: ${result.feedback}`);
        return { behavior: "deny", message: t("plan_rejected_msg", { feedback: result.feedback }) };
      } else {
        log("[PLAN] 계획 거부됨");
        return { behavior: "deny", message: t("plan_rejected_no_feedback") };
      }
    } catch (err) {
      return { behavior: "deny", message: err.message || t("plan_rejected_no_feedback") };
    }
  }

  // 전체 허용 모드: 모든 도구 허용
  if (skipPermissions) {
    return { behavior: "allow", updatedInput: input };
  }

  // 안전 모드: 읽기 전용 도구는 자동 허용
  if (READ_ONLY_TOOLS.has(toolName)) {
    return { behavior: "allow", updatedInput: input };
  }

  // 안전 모드: 쓰기/실행 도구는 텔레그램으로 승인 요청
  try {
    const detail = getToolDetail(toolName, input);
    const allowed = await askToolApproval(toolName, detail, signal);
    if (allowed) {
      log(`[PERM] ${toolName} 도구 승인됨`);
      return { behavior: "allow", updatedInput: input };
    } else {
      log(`[PERM] ${toolName} 도구 거부됨`);
      return { behavior: "deny", message: t("tool_denied_sdk") };
    }
  } catch (err) {
    return { behavior: "deny", message: err.message || "도구 승인 요청 실패" };
  }
}

// ─── Claude Code SDK 실행 ────────────────────────────────────────
async function runClaude(prompt, chatId) {
  if (!sdkQuery) {
    throw new Error(t("sdk_not_loaded"));
  }

  const abortController = new AbortController();
  currentAbortController = abortController;
  const taskStartTime = Date.now();

  const options = {
    cwd: workingDir,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: [
        "IMPORTANT: You are running inside a Telegram bot, not a terminal.",
        "- All tool permissions are handled automatically through the bot. Do NOT tell the user to restart Claude Code, change permission settings, or run commands in a terminal.",
        "- If a tool call fails, try a different approach instead of asking the user to fix permissions.",
        "- Plan mode (EnterPlanMode/ExitPlanMode) works through Telegram approval buttons. When you call ExitPlanMode, the user will see approve/reject buttons in Telegram.",
        "- Write files directly when needed. Do not hesitate to use Write, Edit, or Bash tools.",
        currentLang === "ko"
          ? "- ALWAYS respond in Korean (한국어) to the user. Use Korean for all explanations and messages."
          : "- ALWAYS respond in English to the user. Use English for all explanations and messages.",
        "- When creating tables, ALWAYS use monospace code blocks (```...```) instead of markdown table syntax (|---|). Telegram does not render markdown tables properly.",
      ].join("\n"),
    },
    tools: { type: "preset", preset: "claude_code" },
    abortController,
    canUseTool: handleToolPermission,
    // Phase 1: SDK 신기능
    maxBudgetUsd: currentBudget,
    effort: currentEffort,
    compaction: {
      enabled: true,
      contextTokenThreshold: CONFIG.COMPACTION_THRESHOLD,
    },
  };

  // 기존 세션이 있으면 대화 이어가기
  if (sessionId) {
    options.resume = sessionId;
  }

  log(`[SDK] query() 호출 — prompt: "${prompt.substring(0, 80)}..." session: ${sessionId || "(새 세션)"}`);

  try {
    const q = sdkQuery({ prompt, options });

    let resultText = "";
    let statsText = "";
    let newSessionId = null;
    let progressMsgId = null;
    let lastProgressUpdate = 0;
    let sentIntermediateText = false;
    let turnCount = 0;
    let lastPeriodicUpdate = Date.now();
    const PERIODIC_UPDATE_INTERVAL = CONFIG.PERIODIC_UPDATE_INTERVAL;

    // Phase 2: 스트리밍 응답
    let streamingMsgId = null;
    let streamingBuffer = "";
    let lastStreamUpdate = 0;

    for await (const message of q) {
      if (message.session_id) {
        newSessionId = message.session_id;
      }

      // assistant 메시지 처리: 텍스트 전송 + 도구 진행 표시
      if (message.type === "assistant" && message.message?.content) {
        turnCount++;

        // 주기적 진행 알림 (2분마다)
        const periodicNow = Date.now();
        if (periodicNow - lastPeriodicUpdate >= PERIODIC_UPDATE_INTERVAL) {
          lastPeriodicUpdate = periodicNow;
          const elapsedSec = Math.floor((periodicNow - taskStartTime) / 1000);
          const elapsedMin = Math.floor(elapsedSec / 60);
          const elapsedSecRem = elapsedSec % 60;
          const timeStr = elapsedMin > 0 ? t("time_min_sec", { min: elapsedMin, sec: elapsedSecRem }) : t("time_sec", { sec: elapsedSecRem });
          try {
            await safeSend(chatId, t("progress_update", { turns: turnCount, time: timeStr }), {
              disable_notification: true,
            });
          } catch {}
        }

        for (const block of message.message.content) {
          // 중간 텍스트 → 스트리밍 업데이트
          if (block.type === "text" && block.text?.trim()) {
            // 진행 메시지가 있으면 먼저 삭제
            if (progressMsgId) {
              try { await bot.deleteMessage(chatId, progressMsgId); } catch {}
              progressMsgId = null;
            }

            streamingBuffer += block.text;
            const now = Date.now();

            if (now - lastStreamUpdate >= CONFIG.STREAMING_THROTTLE) {
              const displayText = streamingBuffer.length > MAX_MSG_LENGTH
                ? "..." + streamingBuffer.slice(-(MAX_MSG_LENGTH - 20))
                : streamingBuffer;

              try {
                if (streamingMsgId) {
                  await bot.editMessageText(displayText, {
                    chat_id: chatId, message_id: streamingMsgId,
                    parse_mode: "Markdown",
                  });
                } else {
                  const sent = await safeSend(chatId, displayText, { parse_mode: "Markdown" });
                  streamingMsgId = sent?.message_id;
                }
              } catch (err) {
                // 마크다운 파싱 실패 시 일반 텍스트로 재시도
                if (err.message?.includes("can't parse entities") || err.message?.includes("Bad Request")) {
                  try {
                    if (streamingMsgId) {
                      await bot.editMessageText(displayText, {
                        chat_id: chatId, message_id: streamingMsgId,
                      });
                    } else {
                      const sent = await bot.sendMessage(chatId, displayText);
                      streamingMsgId = sent.message_id;
                    }
                  } catch {}
                }
              }
              lastStreamUpdate = now;
            }
            sentIntermediateText = true;
          }

          if (block.type === "tool_use") {
            // verbosity 0: 도구 진행 표시 안함
            if (currentVerbosity === 0) continue;

            // 스트리밍 중이던 텍스트를 확정하고 새 도구 진행 메시지 준비
            if (streamingMsgId && streamingBuffer) {
              try {
                await bot.editMessageText(streamingBuffer.length > MAX_MSG_LENGTH ? "..." + streamingBuffer.slice(-(MAX_MSG_LENGTH - 20)) : streamingBuffer, {
                  chat_id: chatId, message_id: streamingMsgId, parse_mode: "Markdown",
                });
              } catch {
                try {
                  await bot.editMessageText(streamingBuffer.length > MAX_MSG_LENGTH ? "..." + streamingBuffer.slice(-(MAX_MSG_LENGTH - 20)) : streamingBuffer, {
                    chat_id: chatId, message_id: streamingMsgId,
                  });
                } catch {}
              }
              streamingMsgId = null;
              streamingBuffer = "";
            }

            const now = Date.now();
            if (now - lastProgressUpdate >= CONFIG.PROGRESS_THROTTLE) {
              const icon = TOOL_ICONS[block.name] || "🔧";
              let detail;
              if (currentVerbosity >= 2) {
                // 상세 모드: 도구 입력 전체 표시
                const inputStr = JSON.stringify(block.input || {}, null, 0).substring(0, 200);
                detail = `\n\`\`\`\n${inputStr}\n\`\`\``;
              } else {
                detail = block.name === "Bash"
                  ? ` \`${(block.input?.command || "").substring(0, 60)}\``
                  : block.name === "Read" || block.name === "Edit" || block.name === "Write"
                  ? ` \`${(block.input?.file_path || "").split(/[/\\]/).pop()}\``
                  : "";
              }
              try {
                const toolMsg = `${icon} ${block.name}${detail}`;
                if (currentVerbosity >= 2) {
                  // 상세 모드: 매번 새 메시지 (editMessage가 아닌)
                  await bot.sendMessage(chatId, toolMsg, { parse_mode: "Markdown", disable_notification: true });
                } else if (progressMsgId) {
                  await bot.editMessageText(toolMsg, {
                    chat_id: chatId, message_id: progressMsgId, parse_mode: "Markdown",
                  });
                } else {
                  const sent = await bot.sendMessage(chatId, toolMsg, { parse_mode: "Markdown", disable_notification: true });
                  progressMsgId = sent.message_id;
                }
              } catch {}
              lastProgressUpdate = now;
            }
          }
        }
      }

      if (message.type === "result") {
        // 진행 메시지 삭제
        if (progressMsgId) {
          try { await bot.deleteMessage(chatId, progressMsgId); } catch {}
        }

        // 스트리밍 중이던 메시지 최종 업데이트
        if (streamingMsgId && streamingBuffer) {
          const finalText = streamingBuffer.length > MAX_MSG_LENGTH
            ? "..." + streamingBuffer.slice(-(MAX_MSG_LENGTH - 20))
            : streamingBuffer;
          try {
            await bot.editMessageText(finalText, {
              chat_id: chatId, message_id: streamingMsgId, parse_mode: "Markdown",
            });
          } catch {
            try {
              await bot.editMessageText(finalText, {
                chat_id: chatId, message_id: streamingMsgId,
              });
            } catch {}
          }
        }

        if (message.subtype === "success") {
          // 스트리밍으로 이미 텍스트를 보냈으면 최종 결과는 생략 (중복 방지)
          resultText = sentIntermediateText ? "" : (message.result || t("empty_response"));
        } else {
          const errors = message.errors?.join("\n") || t("error_unknown");
          resultText = t("error_prefix", { error: errors });
        }

        log(`[SDK] 완료 — turns: ${message.num_turns}, cost: $${message.total_cost_usd?.toFixed(4) || "?"}`);

        // 완료 통계 생성
        const elapsed = Date.now() - taskStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        const durationStr = minutes > 0 ? t("time_min_sec", { min: minutes, sec: seconds }) : t("time_sec", { sec: seconds });
        const turns = message.num_turns || 0;
        const cost = message.total_cost_usd?.toFixed(2) || "?";
        statsText = t("stats_done", { turns, cost, duration: durationStr });
      }
    }

    // 세션 ID 저장 (다음 대화에서 resume 용)
    if (newSessionId) {
      sessionId = newSessionId;
    }

    return { text: resultText, stats: statsText };
  } finally {
    currentAbortController = null;
  }
}

// ─── Preview 기능 ────────────────────────────────────────────────

const FILE_CATEGORIES = {
  html: new Set([".html", ".htm"]),
  image: new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]),
  executable: new Set([".exe"]),
  script: new Map([
    [".py", "python"], [".js", "node"], [".bat", "cmd /c"], [".cmd", "cmd /c"],
    [".ps1", "powershell -ExecutionPolicy Bypass -File"],
    [".sh", "bash"], [".ts", "npx tsx"],
  ]),
};

function detectFileCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (FILE_CATEGORIES.html.has(ext)) return "html";
  if (FILE_CATEGORIES.image.has(ext)) return "image";
  if (FILE_CATEGORIES.executable.has(ext)) return "executable";
  if (FILE_CATEGORIES.script.has(ext)) return "script";
  return "other";
}

function getScriptRunner(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return FILE_CATEGORIES.script.get(ext) || null;
}

function startPreviewServer() {
  if (expressServer) return;
  const app = express();
  app.use(express.static(workingDir));
  expressServer = app.listen(PREVIEW_PORT, () => {
    log(`[PREVIEW] Express static server started on port ${PREVIEW_PORT} → ${workingDir}`);
  });
  expressServer.on("error", (err) => {
    logError(`[PREVIEW] Server error: ${err.message}`);
    expressServer = null;
  });
}

function stopPreviewServer() {
  if (expressServer) {
    expressServer.close();
    expressServer = null;
    log("[PREVIEW] Express server stopped");
  }
}

async function startTunnel() {
  if (tunnelUrl) return tunnelUrl;
  startPreviewServer();
  try {
    const { Tunnel } = await import("cloudflared");
    const t = Tunnel.quick(`http://localhost:${PREVIEW_PORT}`);
    tunnelProcess = t;

    // URL 이벤트 대기 (최대 30초)
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Tunnel URL timeout (30s)")), 30000);
      t.once("url", (u) => { clearTimeout(timeout); resolve(u); });
      t.once("error", (err) => { clearTimeout(timeout); reject(err); });
    });

    tunnelUrl = url;
    log(`[TUNNEL] Cloudflare tunnel ready: ${tunnelUrl}`);

    // 프로세스 종료 감지
    t.on("exit", (code) => {
      log(`[TUNNEL] Process exited with code ${code}`);
      tunnelProcess = null;
      tunnelUrl = null;
    });

    return tunnelUrl;
  } catch (err) {
    logError(`[TUNNEL] Failed to start: ${err.message}`);
    throw err;
  }
}

function stopTunnel() {
  if (tunnelProcess) {
    tunnelProcess.stop();
    tunnelProcess = null;
    tunnelUrl = null;
    log("[TUNNEL] Tunnel stopped");
  }
  stopPreviewServer();
}

function bringWindowToFront(pid) {
  return new Promise((resolve) => {
    const script = path.join(os.tmpdir(), `bringfront_${Date.now()}.ps1`);
    const ps = `
Add-Type -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
"@ -Name W32 -Namespace Win32 -ErrorAction SilentlyContinue

$pids = @(${pid})
$q = @(${pid})
while ($q.Count -gt 0) {
  $next = @()
  foreach ($p in $q) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue |
      ForEach-Object { $pids += $_.ProcessId; $next += $_.ProcessId }
  }
  $q = $next
}
foreach ($p in $pids) {
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
    [Win32.W32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
    [Win32.W32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 500
    break
  }
}
`;
    fs.writeFileSync(script, ps);
    exec(`powershell -ExecutionPolicy Bypass -File "${script}"`, { timeout: 8000 }, () => {
      try { fs.unlinkSync(script); } catch {}
      resolve();
    });
  });
}

function takeScreenshot(outputPath) {
  return new Promise((resolve, reject) => {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${outputPath.replace(/\\/g, "\\\\")}')
$g.Dispose()
$bmp.Dispose()
`.trim().replace(/\n/g, "; ");
    exec(`powershell -Command "${ps}"`, { timeout: 10000 }, (err) => {
      if (err) reject(err);
      else resolve(outputPath);
    });
  });
}

function runScript(command, cwd) {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: CONFIG.SCRIPT_TIMEOUT, maxBuffer: CONFIG.SCRIPT_MAX_OUTPUT }, (err, stdout, stderr) => {
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n" : "") + stderr;
      if (err && !output) output = err.message;
      resolve(output || t("no_output"));
    });
  });
}

// 스크립트 실행 후 3초 내 종료 → stdout, 아직 실행 중 → GUI로 판단 → 스크린샷
function runScriptSmart(command, cwd) {
  return new Promise((resolve) => {
    const child = exec(command, { cwd, maxBuffer: CONFIG.SCRIPT_MAX_OUTPUT, timeout: CONFIG.SCRIPT_TIMEOUT });

    let stdout = "";
    let stderr = "";
    let exited = false;

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("exit", () => { exited = true; });

    // 3초 대기
    setTimeout(() => {
      if (exited) {
        // 콘솔 스크립트: stdout 반환
        let output = stdout;
        if (stderr) output += (output ? "\n" : "") + stderr;
        resolve({ type: "text", output: output || t("no_output") });
      } else {
        // GUI 스크립트: 스크린샷
        resolve({ type: "gui", child });
      }
    }, CONFIG.SCRIPT_GUI_DETECT_MS);
  });
}

// ─── 명령어 핸들러 ───────────────────────────────────────────────

// /start - 봇 시작 + 유저 ID 안내
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name || "User";

  log(`[INFO] /start from user: ${userName} (ID: ${userId})`);

  if (!AUTHORIZED_USER_ID) {
    await bot.sendMessage(
      chatId,
      t("start_no_auth", { name: userName, id: userId }),
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (!isAuthorized(msg)) {
    await bot.sendMessage(chatId, t("start_unauthorized"));
    return;
  }

  await bot.sendMessage(
    chatId,
    t("start_welcome", { session: sessionId || t("session_none"), dir: workingDir }),
    { parse_mode: "Markdown" }
  );
});

// /new - 새 세션 시작
bot.onText(/\/new/, async (msg) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;

  // 활성 세션 감지
  const activeSessions = findActiveSessions(workingDir);
  if (activeSessions.length > 0) {
    const s = activeSessions[0];
    const timeStr = s.mtime.toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    await bot.sendMessage(chatId,
      t("active_session_detected", { preview: s.preview || t("content_empty"), time: timeStr }), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: t("btn_resume_active"), callback_data: "resume_startup" },
            { text: t("btn_new_session"), callback_data: "new_force" },
          ],
        ],
      },
    });
    return;
  }

  sessionId = null;
  skipPermissions = false;
  needsPermissionChoice = true;

  await bot.sendMessage(
    chatId,
    t("new_session_started", { dir: workingDir }),
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: t("btn_safe_mode"), callback_data: "perm_safe" },
            { text: t("btn_skip_mode"), callback_data: "perm_skip" },
          ],
        ],
      },
    }
  );
});

// 콜백 쿼리 핸들러 (권한 모드 선택 + AskUserQuestion 응답)
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  // 잠금 체크 (unlock 관련 콜백만 통과)
  if (isLocked && !query.data.startsWith("tool_approve")) {
    await bot.answerCallbackQuery(query.id, { text: t("bot_locked") });
    return;
  }

  // 빠른 액션 버튼
  if (query.data.startsWith("quick_")) {
    await bot.answerCallbackQuery(query.id);
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch {}

    if (query.data === "quick_cleanup") {
      await bot.sendMessage(chatId, t("quick_cleanup_msg"), { disable_notification: true });
      await bot.sendMessage(chatId, t("quick_cleanup_hint"), { parse_mode: "Markdown" });
    } else if (query.data === "quick_commit") {
      if (isProcessing) {
        await bot.sendMessage(chatId, t("already_processing"), { disable_notification: true });
      } else {
        processMessage(chatId, t("auto_commit_prompt"));
      }
    } else if (query.data === "quick_summary") {
      if (isProcessing) {
        await bot.sendMessage(chatId, t("already_processing"), { disable_notification: true });
      } else {
        processMessage(chatId, t("auto_summary_prompt"));
      }
    }
    return;
  }

  // Phase 3: 삭제 확인/취소
  if (query.data.startsWith("del_yes_")) {
    await bot.answerCallbackQuery(query.id);
    const id = query.data.replace("del_yes_", "");
    const target = lookupPath(id);
    if (!target) return;

    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.unlinkSync(target);
      }
      await bot.editMessageText(t("delete_done", { path: path.relative(workingDir, target) }), {
        chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown",
      });
      log(`[DELETE] ${target}`);
    } catch (err) {
      await bot.editMessageText(t("delete_error", { error: err.message }), {
        chat_id: chatId, message_id: query.message.message_id,
      });
    }
    return;
  }

  if (query.data === "del_cancel") {
    await bot.answerCallbackQuery(query.id);
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch {}
    return;
  }

  // Phase 3: Revert 콜백
  if (query.data === "revert_all" || query.data === "revert_code") {
    await bot.answerCallbackQuery(query.id);
    const cmd = query.data === "revert_all"
      ? "git checkout -- ."
      : 'git checkout -- "*.js" "*.ts" "*.py" "*.jsx" "*.tsx" "*.css" "*.html"';
    exec(cmd, { cwd: workingDir }, async (err) => {
      if (err) {
        await bot.editMessageText(t("revert_error", { error: err.message }), {
          chat_id: chatId, message_id: query.message.message_id,
        });
      } else {
        await bot.editMessageText(t("revert_done"), {
          chat_id: chatId, message_id: query.message.message_id,
        });
        log(`[REVERT] ${query.data}`);
      }
    });
    return;
  }

  if (query.data === "revert_cancel") {
    await bot.answerCallbackQuery(query.id);
    await bot.editMessageText(t("revert_cancelled"), {
      chat_id: chatId, message_id: query.message.message_id,
    });
    return;
  }

  // Phase 2: 파일 보기/다운로드 버튼
  if (query.data.startsWith("fview_") || query.data.startsWith("fdown_")) {
    await bot.answerCallbackQuery(query.id);
    const isView = query.data.startsWith("fview_");
    const id = query.data.replace(/^(fview_|fdown_)/, "");
    const filePath = lookupPath(id);

    if (!filePath || !fs.existsSync(filePath) || !isInsideWorkingDir(filePath, workingDir)) {
      await bot.sendMessage(chatId, "❌ File not found.");
      return;
    }

    try {
      if (isView) {
        const content = fs.readFileSync(filePath, "utf-8").substring(0, 3800);
        const name = path.basename(filePath);
        await safeSend(chatId, `📄 \`${name}\`\n\`\`\`\n${content}\n\`\`\``, { parse_mode: "Markdown" });
      } else {
        await bot.sendDocument(chatId, filePath);
      }
    } catch (err) {
      await bot.sendMessage(chatId, `❌ ${err.message}`);
    }
    return;
  }

  // Phase 2: 번호 선택 버튼
  if (query.data.startsWith("numopt_")) {
    await bot.answerCallbackQuery(query.id);
    const num = query.data.replace("numopt_", "");
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch {}
    if (!isProcessing) {
      processMessage(chatId, num);
    }
    return;
  }

  // 시작 시 이전 세션 이어받기 버튼
  if (query.data === "resume_startup") {
    const sessions = findRecentSessions(workingDir, 1);
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText(
        t("session_resumed", { time: sessions[0].mtime.toLocaleString(getLocale()) }),
        {
          chat_id: chatId, message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: [[
              { text: t("btn_safe_mode_short"), callback_data: "perm_safe" },
              { text: t("btn_skip_mode"), callback_data: "perm_skip" },
            ]],
          },
        }
      );
      log(`[RESUME] 시작 시 세션 이어받기: ${sessionId}`);
    } else {
      await bot.answerCallbackQuery(query.id, { text: t("no_session_to_resume") });
    }
    return;
  }

  // 새 세션 강제 시작 (활성 세션 무시)
  if (query.data === "new_force") {
    await bot.answerCallbackQuery(query.id);
    sessionId = null;
    skipPermissions = false;
    needsPermissionChoice = true;
    await bot.editMessageText(
      t("new_session_started", { dir: workingDir }),
      {
        chat_id: chatId, message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: t("btn_safe_mode"), callback_data: "perm_safe" },
            { text: t("btn_skip_mode"), callback_data: "perm_skip" },
          ]],
        },
      }
    );
    return;
  }

  // 사진만 보내기 버튼
  if (query.data === "photo_only") {
    await bot.answerCallbackQuery(query.id);
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch {}
    if (pendingPhoto) {
      processPendingPhoto(null);
    }
    return;
  }

  // Preview 프로세스 종료 버튼
  if (query.data === "preview_kill") {
    await bot.answerCallbackQuery(query.id);
    if (previewChildPid) {
      exec(`taskkill /PID ${previewChildPid} /T /F`, () => {});
      await bot.editMessageText(t("process_killed", { pid: previewChildPid }), {
        chat_id: chatId, message_id: query.message.message_id,
      });
      previewChildPid = null;
    } else {
      await bot.editMessageText(t("process_already_killed"), {
        chat_id: chatId, message_id: query.message.message_id,
      });
    }
    return;
  }

  // 세션 이어받기 선택
  if (query.data.startsWith("resume_") && pendingResumeSessions) {
    const idx = parseInt(query.data.replace("resume_", ""), 10);
    const selected = pendingResumeSessions[idx];
    if (!selected) {
      await bot.answerCallbackQuery(query.id, { text: t("ask_invalid_choice") });
      return;
    }

    sessionId = selected.id;
    pendingResumeSessions = null;

    await bot.answerCallbackQuery(query.id);
    await bot.editMessageText(
      t("session_resumed_full", {
        time: selected.mtime.toLocaleString(getLocale()),
        preview: selected.preview ? `💬 ${selected.preview}\n` : "",
      }),
      { chat_id: chatId, message_id: query.message.message_id }
    );
    log(`[RESUME] 세션 이어받기: ${sessionId}`);

    // 권한 모드 선택 필요하면 물어보기
    if (needsPermissionChoice) {
      await bot.sendMessage(chatId, t("select_perm_mode"), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: t("btn_safe_mode"), callback_data: "perm_safe" },
              { text: t("btn_skip_mode"), callback_data: "perm_skip" },
            ],
          ],
        },
      });
    }
    return;
  }

  // 권한 모드 선택
  if (query.data === "perm_safe" || query.data === "perm_skip") {
    skipPermissions = query.data === "perm_skip";
    needsPermissionChoice = false;
    await bot.answerCallbackQuery(query.id);
    const modeText = skipPermissions ? t("mode_skip") : t("mode_safe");
    await bot.editMessageText(
      t("mode_set", { mode: modeText }),
      { chat_id: chatId, message_id: query.message.message_id }
    );
    log(`[MODE] ${modeText}`);
    const resumeHint = sessionId ? t("resume_hint") : "";
    await bot.sendMessage(
      chatId,
      t("ready_prompt", { dir: workingDir, resumeHint }),
      { parse_mode: "Markdown" }
    );
    // 대기 중인 메시지가 있으면 자동 처리 (사전에 보낸 메시지)
    if (pendingMessage) {
      const saved = pendingMessage;
      pendingMessage = null;
      bot.emit("message", saved);
    }
    return;
  } else if ((query.data === "tool_approve_yes" || query.data === "tool_approve_no") && pendingToolApproval) {
    // 도구 승인/거부 처리
    const approved = query.data === "tool_approve_yes";
    await bot.answerCallbackQuery(query.id);

    // 플랜 거부 시 피드백 입력 요청
    if (!approved && pendingToolApproval.isPlan) {
      await bot.editMessageText(
        t("plan_rejected_title"),
        { chat_id: chatId, message_id: query.message.message_id }
      );
      pendingPlanRejection = pendingToolApproval;
      pendingToolApproval = null;
      await bot.sendMessage(chatId, t("plan_rejection_input"));
      return;
    }

    await bot.editMessageText(
      approved ? t("tool_approved_msg") : t("tool_denied_msg"),
      { chat_id: chatId, message_id: query.message.message_id }
    );
    pendingToolApproval.resolve(approved);
    return;
  } else if (query.data.startsWith("sdk_ask_") && pendingSdkAsk) {
    // AskUserQuestion 응답 처리
    const ctx = pendingSdkAsk;

    // "직접 입력" 버튼 → 다음 텍스트 메시지를 응답으로 대기
    if (query.data === "sdk_ask_other") {
      await bot.answerCallbackQuery(query.id);
      ctx.waitingTextInput = true;
      ctx.askMessageId = query.message.message_id;
      await bot.sendMessage(chatId, t("ask_enter_text"));
      return;
    }

    const idx = parseInt(query.data.replace("sdk_ask_", ""), 10);
    const selected = ctx.options[idx];

    if (!selected) {
      await bot.answerCallbackQuery(query.id, { text: t("ask_invalid_choice") });
      return;
    }

    pendingSdkAsk = null;
    await bot.answerCallbackQuery(query.id);
    await bot.editMessageText(
      `❓ ${ctx.question}\n➡️ ${selected.label}`,
      { chat_id: chatId, message_id: query.message.message_id }
    );

    // Promise resolve → canUseTool 콜백이 답변을 받아 SDK에 전달
    ctx.resolve(selected.label);
    return;
  }

  // 대기 중인 메시지가 있으면 자동 처리
  if (!needsPermissionChoice && pendingMessage) {
    const saved = pendingMessage;
    pendingMessage = null;
    bot.emit("message", saved);
  }
});

// /status - 현재 상태
bot.onText(/\/status/, async (msg) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    t("status_title", {
      session: sessionId || t("session_empty"),
      dir: workingDir,
      processing: isProcessing ? t("status_processing_yes") : t("status_processing_no"),
      mode: skipPermissions ? t("status_mode_skip") : t("status_mode_safe"),
      budget: currentBudget.toFixed(2),
      effort: currentEffort,
      verbosity: `${currentVerbosity} (${[t("verbose_quiet"), t("verbose_normal"), t("verbose_detailed")][currentVerbosity]})`,
    }),
    { parse_mode: "Markdown" }
  );
});

// /setdir <path> - 작업 디렉토리 변경
bot.onText(/\/setdir(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  const newDir = match[1]?.trim();

  if (!newDir) {
    pendingCommand = { type: "setdir" };
    await bot.sendMessage(
      chatId,
      t("setdir_prompt", { dir: workingDir }),
      { parse_mode: "Markdown" }
    );
    return;
  }

  // 자연어 해석 시도 → 실패하면 정확한 경로로 시도
  const resolved = resolveDirectory(newDir);

  if (!resolved) {
    await bot.sendMessage(chatId, t("setdir_not_found", { dir: newDir }), {
      parse_mode: "Markdown",
    });
    return;
  }

  const dirChanged = workingDir !== resolved;
  workingDir = resolved;
  saveState();
  // 디렉토리가 바뀌면 세션 리셋 (cwd 불일치로 exit code 1 방지)
  if (dirChanged && sessionId) {
    sessionId = null;
    log("[DIR] 디렉토리 변경 → 세션 리셋");
  }
  // 서버가 실행 중이면 재시작 (새 디렉토리 서빙)
  if (expressServer) {
    stopPreviewServer();
    startPreviewServer();
    log("[PREVIEW] Server restarted for new workingDir");
  }
  await bot.sendMessage(
    chatId,
    t("setdir_changed", { dir: workingDir }),
    { parse_mode: "Markdown" }
  );
});

// /cancel - 현재 작업 취소
bot.onText(/\/cancel/, async (msg) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    isProcessing = false;
    // 대기 중인 AskUserQuestion도 취소
    pendingSdkAsk = null;
    await bot.sendMessage(chatId, t("cancel_done"));
  } else {
    await bot.sendMessage(chatId, t("cancel_nothing"));
  }
});

// /restart - 봇 재시작 (exit code 82 → launcher가 감지하여 재시작)
bot.onText(/\/restart/, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, t("restart_msg"));
  bot.stopPolling();
  releaseLock();
  process.exit(82);
});

// /setbudget <amount> — 세션 비용 상한
bot.onText(/\/setbudget(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  const amount = parseFloat(match[1]);
  if (isNaN(amount) || amount <= 0) {
    return safeSend(chatId, t("budget_invalid"), { parse_mode: "Markdown" });
  }
  currentBudget = amount;
  saveState();
  safeSend(chatId, t("budget_set", { amount: amount.toFixed(2) }));
});

// /effort [low|medium|high|max]
bot.onText(/\/effort(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  const level = (match[1] || "").toLowerCase();
  const valid = ["low", "medium", "high", "max"];
  if (!valid.includes(level)) {
    return safeSend(chatId, t("effort_invalid", { current: currentEffort }), { parse_mode: "Markdown" });
  }
  currentEffort = level;
  saveState();
  safeSend(chatId, t("effort_set", { level }));
});

// ─── Phase 2~4 명령어 등록 (commands.js) ────────────────────────
const registerCommands = require("./commands");
const { startWebhookServer } = registerCommands(bot, {
  get workingDir() { return workingDir; },
  get sessionId() { return sessionId; },
  get currentVerbosity() { return currentVerbosity; },
  set currentVerbosity(v) { currentVerbosity = v; },
  get webhookServer() { return webhookServer; },
  set webhookServer(v) { webhookServer = v; },
  get webhookToken() { return webhookToken; },
  set webhookToken(v) { webhookToken = v; },
  get cronCounter() { return cronCounter; },
  set cronCounter(v) { cronCounter = v; },
  cronJobs,
  AUTHORIZED_USER_ID,
  isAuthorized,
  isLockedCheck,
  safeSend,
  t,
  saveState,
  processMessage,
  log,
  logError,
});

// /plan - 다음 메시지에 플랜 모드 적용
bot.onText(/\/plan/, async (msg) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  forcePlanMode = true;
  await bot.sendMessage(chatId, t("plan_activated"));
});

// /lock - 봇 잠금 (2단계: PIN 별도 입력 → 메시지 삭제)
bot.onText(/\/lock/, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  // /lock 뒤에 PIN을 붙여 보냈으면 명령어 메시지 삭제 후 처리
  const inlinePin = msg.text.replace(/^\/lock\s*/, "").trim();
  if (inlinePin) {
    try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
    if (inlinePin.length < 4) {
      await bot.sendMessage(chatId, t("lock_pin_too_short"));
      pendingLockAction = { type: "lock" };
      return;
    }
    pinHash = hashPin(inlinePin);
    isLocked = true;
    saveState();
    await bot.sendMessage(chatId, t("lock_done"));
    log("[LOCK] 봇 잠김");
    return;
  }
  pendingLockAction = { type: "lock" };
  await bot.sendMessage(chatId, t("lock_enter_pin"));
});

// /unlock - 잠금 해제 (2단계: PIN 별도 입력 → 메시지 삭제)
bot.onText(/\/unlock/, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;

  if (!isLocked) {
    await bot.sendMessage(chatId, t("unlock_already"));
    return;
  }

  const inlinePin = msg.text.replace(/^\/unlock\s*/, "").trim();
  if (inlinePin) {
    try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
    if (pinHash && hashPin(inlinePin) === pinHash) {
      isLocked = false;
      pinHash = null;
        pendingLockAction = null;
      saveState();
      await bot.sendMessage(chatId, t("unlock_done"));
      log("[LOCK] 잠금 해제");
    } else {
      await bot.sendMessage(chatId, t("unlock_wrong_pin"));
      pendingLockAction = { type: "unlock" };
    }
    return;
  }
  pendingLockAction = { type: "unlock" };
  await bot.sendMessage(chatId, t("unlock_enter_pin"));
});

// 잠금 체크 헬퍼 함수
function isLockedCheck(msg) {
  if (!isLocked) return false;
  if (msg.text && (msg.text.startsWith("/unlock") || msg.text.startsWith("/lock"))) return false;
  bot.sendMessage(msg.chat.id, t("bot_locked_unlock"), {
    parse_mode: "Markdown",
  }).catch(() => {});
  return true;
}

// /files - 현재 디렉토리 파일 목록
bot.onText(/\/files/, async (msg) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;

  try {
    const entries = fs.readdirSync(workingDir, { withFileTypes: true });
    const list = entries
      .map((e) => {
        const icon = e.isDirectory() ? "📁" : "📄";
        return `${icon} ${e.name}`;
      })
      .join("\n");

    await sendLongMessage(
      chatId,
      `📂 \`${workingDir}\`\n\n${list || t("files_empty")}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await bot.sendMessage(chatId, `❌ 오류: ${err.message}`);
  }
});

// /read <file> - 파일 내용 읽기
bot.onText(/\/read(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  const fileName = match[1]?.trim();

  if (!fileName) {
    pendingCommand = { type: "read" };
    await bot.sendMessage(chatId, t("read_prompt"));
    return;
  }

  const filePath = path.resolve(workingDir, fileName);

  // Path Traversal 방지: 작업 디렉토리 밖의 파일 접근 차단
  if (!isInsideWorkingDir(filePath, workingDir)) {
    await bot.sendMessage(chatId, t("read_path_traversal"));
    return;
  }

  if (!fs.existsSync(filePath)) {
    await bot.sendMessage(chatId, t("read_not_found", { file: fileName }), {
      parse_mode: "Markdown",
    });
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      await bot.sendMessage(chatId, t("read_is_dir", { file: fileName }), {
        parse_mode: "Markdown",
      });
      return;
    }

    if (stat.size > CONFIG.MAX_FILE_READ) {
      await bot.sendMessage(
        chatId,
        t("read_too_large", { size: (stat.size / 1024 / 1024).toFixed(1) })
      );
      return;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(fileName).slice(1);
    const codeBlock = `\`\`\`${ext}\n${content}\n\`\`\``;

    await sendLongMessage(chatId, `📄 \`${fileName}\`\n\n${codeBlock}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    await bot.sendMessage(chatId, t("read_error", { error: err.message }));
  }
});

// /preview <file> - 파일 미리보기
bot.onText(/\/preview(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  const fileName = match[1]?.trim();

  if (!fileName) {
    pendingCommand = { type: "preview" };
    await bot.sendMessage(chatId, t("preview_prompt"));
    return;
  }

  const filePath = path.resolve(workingDir, fileName);

  // Path Traversal 방지
  if (!isInsideWorkingDir(filePath, workingDir)) {
    await bot.sendMessage(chatId, t("read_path_traversal"));
    return;
  }

  if (!fs.existsSync(filePath)) {
    await bot.sendMessage(chatId, t("preview_not_found", { file: fileName }), {
      parse_mode: "Markdown",
    });
    return;
  }

  const category = detectFileCategory(filePath);
  log(`[PREVIEW] ${fileName} → category: ${category}`);

  try {
    if (category === "html") {
      // HTML: Express + Cloudflare tunnel → clickable link
      await bot.sendChatAction(chatId, "typing");
      const url = await startTunnel();
      const relativePath = path.relative(workingDir, filePath).replace(/\\/g, "/");
      const previewUrl = `${url}/${relativePath}`;
      await bot.sendMessage(chatId, t("preview_html_link", { url: previewUrl }));

    } else if (category === "image") {
      // Image: send as photo
      await bot.sendChatAction(chatId, "upload_photo");
      await bot.sendPhoto(chatId, filePath, { caption: `📷 ${fileName}` });

    } else if (category === "executable") {
      // EXE: run → wait 3s → 창 앞으로 → screenshot → send
      await bot.sendMessage(chatId, t("preview_exe_running", { file: fileName }), { parse_mode: "Markdown" });
      const exeChild = exec(`"${filePath}"`, { cwd: workingDir });
      await new Promise((r) => setTimeout(r, 3000));
      await bringWindowToFront(exeChild.pid);
      const screenshotPath = path.join(os.tmpdir(), `preview_${Date.now()}.png`);
      await takeScreenshot(screenshotPath);
      await bot.sendChatAction(chatId, "upload_photo");
      await bot.sendPhoto(chatId, screenshotPath, { caption: t("preview_exe_screenshot", { file: fileName }) });
      try { fs.unlinkSync(screenshotPath); } catch {}

    } else if (category === "script") {
      // Script: 3초 내 종료 → stdout, GUI면 → 스크린샷
      const runner = getScriptRunner(filePath);
      await bot.sendMessage(chatId, t("preview_script_running", { file: fileName }), { parse_mode: "Markdown" });
      const result = await runScriptSmart(`${runner} "${filePath}"`, workingDir);
      if (result.type === "text") {
        const trimmed = result.output.length > 4000 ? result.output.substring(0, 4000) + "\n" + t("preview_output_trimmed") : result.output;
        await sendLongMessage(chatId, t("preview_script_result", { file: fileName, output: trimmed }), {
          parse_mode: "Markdown",
        });
      } else {
        // GUI 앱: 창을 앞으로 가져온 뒤 스크린샷 촬영, 종료 버튼 제공
        await bringWindowToFront(result.child.pid);
        const screenshotPath = path.join(os.tmpdir(), `preview_${Date.now()}.png`);
        await takeScreenshot(screenshotPath);
        await bot.sendChatAction(chatId, "upload_photo");
        await bot.sendPhoto(chatId, screenshotPath, { caption: t("preview_gui_caption", { file: fileName }) });
        try { fs.unlinkSync(screenshotPath); } catch {}
        previewChildPid = result.child.pid;
        await bot.sendMessage(chatId, t("preview_gui_running", { file: fileName, pid: result.child.pid }), {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: t("preview_btn_kill"), callback_data: "preview_kill" },
            ]],
          },
        });
      }

    } else {
      // Other: send as document
      const stat = fs.statSync(filePath);
      if (stat.size > CONFIG.MAX_FILE_SEND) {
        await bot.sendMessage(chatId, t("preview_too_large", { size: (stat.size / 1024 / 1024).toFixed(1) }));
        return;
      }
      await bot.sendChatAction(chatId, "upload_document");
      await bot.sendDocument(chatId, filePath, { caption: `📎 ${fileName}` });
    }
  } catch (err) {
    await bot.sendMessage(chatId, t("preview_error", { error: err.message }));
  }
});

// /tunnel [status|start|stop] - 터널 관리
bot.onText(/\/tunnel(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  const action = (match[1] || "status").trim().toLowerCase();

  if (action === "status") {
    if (tunnelUrl) {
      await bot.sendMessage(chatId, t("tunnel_active", { url: tunnelUrl }));
    } else {
      await bot.sendMessage(chatId, t("tunnel_inactive"));
    }
  } else if (action === "start") {
    if (tunnelUrl) {
      await bot.sendMessage(chatId, t("tunnel_already_active", { url: tunnelUrl }));
      return;
    }
    try {
      await bot.sendMessage(chatId, t("tunnel_starting"));
      const url = await startTunnel();
      await bot.sendMessage(chatId, t("tunnel_started", { url }));
    } catch (err) {
      await bot.sendMessage(chatId, t("tunnel_start_failed", { error: err.message }));
    }
  } else if (action === "stop") {
    if (!tunnelUrl && !tunnelProcess) {
      await bot.sendMessage(chatId, t("tunnel_already_inactive"));
      return;
    }
    stopTunnel();
    await bot.sendMessage(chatId, t("tunnel_stopped"));
  } else {
    await bot.sendMessage(chatId, t("tunnel_usage"), { parse_mode: "Markdown" });
  }
});

// /resume [latest] - 터미널 세션 이어받기
bot.onText(/\/resume(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  const arg = match[1]?.trim();

  const sessions = findRecentSessions(workingDir);

  if (sessions.length === 0) {
    await bot.sendMessage(
      chatId,
      t("resume_no_sessions", { dir: workingDir }),
      { parse_mode: "Markdown" }
    );
    return;
  }

  // /resume latest → 가장 최근 세션 자동 선택
  if (arg === "latest") {
    const s = sessions[0];
    sessionId = s.id;
    log(`[RESUME] 최신 세션 이어받기: ${sessionId}`);
    await bot.sendMessage(
      chatId,
      t("session_resumed_full", {
        time: s.mtime.toLocaleString(getLocale()),
        preview: s.preview ? `💬 ${s.preview}\n` : "",
      }),
    );

    if (needsPermissionChoice) {
      await bot.sendMessage(chatId, t("select_perm_mode"), {
        reply_markup: {
          inline_keyboard: [
            [
              { text: t("btn_safe_mode"), callback_data: "perm_safe" },
              { text: t("btn_skip_mode"), callback_data: "perm_skip" },
            ],
          ],
        },
      });
    }
    return;
  }

  // 세션 목록 표시 (인라인 키보드)
  const buttons = sessions.map((s, i) => {
    const timeStr = s.mtime.toLocaleString(getLocale(), {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const activeTag = s.active ? "🟢 " : "";
    const dirTag = s.dirLabel ? `[${s.dirLabel}] ` : "";
    const previewStr = s.preview ? ` — ${s.preview.substring(0, 16)}` : "";
    return [{ text: `${activeTag}${dirTag}${timeStr}${previewStr}`, callback_data: `resume_${i}` }];
  });

  pendingResumeSessions = sessions;

  await bot.sendMessage(
    chatId,
    t("resume_select", { dir: workingDir }),
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }
  );
});


// ─── 일반 메시지 처리 (Claude Code에 전달) ───────────────────────

async function processMessage(chatId, prompt) {
  isProcessing = true;

  // typing indicator
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, "typing").catch(() => {});
  }, CONFIG.TYPING_INTERVAL);

  try {
    const result = await runClaude(prompt, chatId);
    const response = result.text || "";

    log(`[USER] ${prompt}`);
    log(`[CLAUDE] ${response.substring(0, 200)}${response.length > 200 ? "..." : ""}`);
    log("─".repeat(50));

    if (response) {
      await sendLongMessage(chatId, response, { parse_mode: "Markdown" });

      // Phase 2: 파일 경로 감지 → 다운로드 버튼
      const filePaths = extractFilePaths(response, workingDir);
      if (filePaths.length > 0) {
        await bot.sendMessage(chatId, t("files_detected"), {
          reply_markup: { inline_keyboard: buildFileButtons(filePaths) },
        });
      }

      // Phase 2: 번호 목록 → 인라인 버튼
      const options = extractNumberedOptions(response);
      if (options.length > 0) {
        await bot.sendMessage(chatId, t("select_option"), {
          reply_markup: { inline_keyboard: buildOptionButtons(options) },
        });
      }
    }

    // 완료 통계 + 빠른 액션 버튼
    await bot.sendMessage(chatId, result.stats || "⚡", {
      reply_markup: {
        inline_keyboard: [[
          { text: t("btn_cleanup"), callback_data: "quick_cleanup" },
          { text: t("btn_commit"), callback_data: "quick_commit" },
          { text: t("btn_summary"), callback_data: "quick_summary" },
        ]],
      },
    });
  } catch (err) {
    // 취소된 경우 무시
    if (err.name === "AbortError" || err.message?.includes("abort")) {
      log("[INFO] 작업이 취소되었습니다.");
      return;
    }

    let errorMsg = `❌ Claude Code 오류:\n\`\`\`\n${err.message}\n\`\`\``;

    if (err.message.includes("ENOENT") || err.message.includes("not found")) {
      errorMsg += t("error_sdk_hint");
    }

    await sendLongMessage(chatId, errorMsg, { parse_mode: "Markdown" });
  } finally {
    clearInterval(typingInterval);
    isProcessing = false;

    // 대기열의 다음 메시지 처리
    if (messageQueue.length > 0) {
      const next = messageQueue.shift();
      processMessage(next.chatId, next.prompt);
    }
  }
}

// ─── 대기 중인 사진 (캡션 없이 보낸 사진 → 후속 텍스트 대기) ───
let pendingPhoto = null; // { chatId, savePath }

// ─── 업로드 헬퍼 ─────────────────────────────────────────────────
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}

function cleanupUploads(uploadsDir, maxFiles = 10) {
  try {
    const files = fs.readdirSync(uploadsDir)
      .map(f => ({ name: f, time: fs.statSync(path.join(uploadsDir, f)).mtimeMs }))
      .sort((a, b) => a.time - b.time);
    while (files.length > maxFiles) {
      const old = files.shift();
      fs.unlinkSync(path.join(uploadsDir, old.name));
      log(`[UPLOAD] 오래된 파일 삭제: ${old.name}`);
    }
  } catch {}
}

// ─── 파일/사진 업로드 처리 ────────────────────────────────────────

function downloadTelegramFile(fileInfo, savePath) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    const fileStream = fs.createWriteStream(savePath);
    https.get(url, (res) => {
      res.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });
      fileStream.on("error", reject);
    }).on("error", reject);
  });
}

function processPendingPhoto(textPrompt) {
  if (!pendingPhoto) return false;
  const { chatId, savePath } = pendingPhoto;
  pendingPhoto = null;
  const prompt = textPrompt
    ? t("photo_prompt_with_text", { path: savePath, text: textPrompt })
    : t("photo_prompt_no_text", { path: savePath });
  processMessage(chatId, prompt);
  return true;
}

bot.on("photo", async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const photo = msg.photo[msg.photo.length - 1]; // 최대 해상도
  const caption = msg.caption || "";

  try {
    const file = await bot.getFile(photo.file_id);
    const ext = path.extname(file.file_path) || ".jpg";
    const fileName = caption
      ? caption.replace(/[<>:"/\\|?*]/g, "_") + ext
      : `photo_${Date.now()}${ext}`;
    const uploadsDir = ensureUploadsDir();
    const savePath = path.join(uploadsDir, fileName);

    await downloadTelegramFile(file, savePath);
    cleanupUploads(uploadsDir);
    log(`[UPLOAD] 사진 저장: ${savePath}`);

    if (caption) {
      // 캡션이 있으면 즉시 처리
      const prompt = t("photo_prompt_with_text", { path: savePath, text: caption });
      processMessage(chatId, prompt);
    } else {
      // 캡션이 없으면 후속 텍스트 메시지 대기
      pendingPhoto = { chatId, savePath };
      await bot.sendMessage(chatId, t("photo_received"), {
        disable_notification: true,
        reply_markup: {
          inline_keyboard: [[
            { text: t("btn_photo_only"), callback_data: "photo_only" },
          ]],
        },
      });
    }
  } catch (err) {
    await bot.sendMessage(chatId, t("photo_save_failed", { error: err.message }));
  }
});

bot.on("document", async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const doc = msg.document;
  const caption = msg.caption || "";

  try {
    const file = await bot.getFile(doc.file_id);
    const fileName = doc.file_name || `file_${Date.now()}`;
    const uploadsDir = ensureUploadsDir();
    const savePath = path.join(uploadsDir, fileName);

    await downloadTelegramFile(file, savePath);
    cleanupUploads(uploadsDir);
    log(`[UPLOAD] 파일 저장: ${savePath}`);
    const prompt = caption
      ? t("doc_prompt_with_text", { path: savePath, text: caption })
      : t("doc_prompt_no_text", { path: savePath });
    processMessage(chatId, prompt);
  } catch (err) {
    await bot.sendMessage(chatId, t("doc_save_failed", { error: err.message }));
  }
});

// ─── Phase 2: 음성 메시지 처리 ──────────────────────────────────
let openaiClient = null;
try {
  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require("openai");
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    log("[VOICE] OpenAI Whisper 활성화");
  }
} catch {
  log("[VOICE] openai 패키지 없음 — 음성 기능 비활성화");
}

bot.on("voice", async (msg) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;

  if (!openaiClient) {
    return safeSend(chatId, t("voice_not_configured"), { parse_mode: "Markdown" });
  }

  await bot.sendChatAction(chatId, "typing");
  await safeSend(chatId, t("voice_transcribing"), { disable_notification: true });

  try {
    const file = await bot.getFile(msg.voice.file_id);
    const voicePath = path.join(ensureUploadsDir(), `voice_${Date.now()}.ogg`);
    await downloadTelegramFile(file, voicePath);

    const transcription = await openaiClient.audio.transcriptions.create({
      file: fs.createReadStream(voicePath),
      model: "whisper-1",
      language: currentLang === "ko" ? "ko" : "en",
    });

    const text = transcription.text;
    try { fs.unlinkSync(voicePath); } catch {}

    await safeSend(chatId, t("voice_transcribed", { text }), {
      parse_mode: "Markdown", disable_notification: true,
    });

    processMessage(chatId, text);
  } catch (err) {
    await safeSend(chatId, t("voice_error", { error: err.message }));
  }
});

// ─── 일반 메시지 처리 ─────────────────────────────────────────────
bot.on("message", async (msg) => {
  // 명령어는 무시 (위의 핸들러에서 처리)
  if (msg.text && msg.text.startsWith("/")) return;
  // 파일/사진/음성은 위의 핸들러에서 처리
  if (msg.photo || msg.document || msg.voice) return;
  if (!msg.text) return;
  if (!isAuthorized(msg)) {
    if (!AUTHORIZED_USER_ID) {
      await bot.sendMessage(
        msg.chat.id,
        t("user_id_info", { id: msg.from.id }),
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  const chatId = msg.chat.id;

  // 잠금 체크 (PIN 입력 대기 중이면 통과)
  if (isLocked && !pendingLockAction) {
    await bot.sendMessage(chatId, t("bot_locked_unlock"), {
      parse_mode: "Markdown",
    });
    return;
  }

  const prompt = msg.text;

  // 첫 메시지 시 권한 모드 선택
  if (needsPermissionChoice) {
    pendingMessage = msg;
    await bot.sendMessage(
      chatId,
      t("first_select_perm"),
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: t("btn_safe_mode"), callback_data: "perm_safe" },
              { text: t("btn_skip_mode"), callback_data: "perm_skip" },
            ],
          ],
        },
      }
    );
    return;
  }

  // 대기 중인 명령어 처리 (인자 없이 보내진 /setdir, /read, /preview)
  if (pendingCommand) {
    const cmd = pendingCommand;
    pendingCommand = null;

    if (cmd.type === "setdir") {
      // resolveDirectory로 자연어 해석
      const resolved = resolveDirectory(prompt);
      if (resolved) {
        const dirChanged = workingDir !== resolved;
        workingDir = resolved;
        saveState();
        if (dirChanged && sessionId) {
          sessionId = null;
          log("[DIR] 디렉토리 변경 → 세션 리셋");
        }
        if (expressServer) { stopPreviewServer(); startPreviewServer(); }
        await bot.sendMessage(chatId, t("setdir_changed", { dir: workingDir }), { parse_mode: "Markdown" });
        log(`[DIR] ${workingDir}`);
      } else {
        await bot.sendMessage(chatId, t("setdir_not_found", { dir: prompt }), { parse_mode: "Markdown" });
      }
      return;
    }

    if (cmd.type === "read" || cmd.type === "preview") {
      // 명령어 + 인자로 재구성해서 다시 처리
      const fakeMsg = { ...msg, text: `/${cmd.type} ${prompt}` };
      bot.emit("message", fakeMsg);
      return;
    }
  }

  // 잠금/해제 PIN 입력 대기 중이면 텍스트를 PIN으로 처리
  if (pendingLockAction) {
    const action = pendingLockAction;
    // PIN 메시지 즉시 삭제
    try { await bot.deleteMessage(chatId, msg.message_id); } catch {}
    if (action.type === "lock") {
      if (prompt.length < 4) {
        await bot.sendMessage(chatId, t("lock_pin_too_short"));
        return;
      }
      pendingLockAction = null;
      pinHash = hashPin(prompt);
        isLocked = true;
      saveState();
      await bot.sendMessage(chatId, t("lock_done"));
      log("[LOCK] 봇 잠김");
    } else {
      // unlock
      if (pinHash && hashPin(prompt) === pinHash) {
        pendingLockAction = null;
        isLocked = false;
        pinHash = null;
            saveState();
        await bot.sendMessage(chatId, t("unlock_done"));
        log("[LOCK] 잠금 해제");
      } else {
        await bot.sendMessage(chatId, t("unlock_wrong_pin"));
      }
    }
    return;
  }

  // 플랜 거부 피드백 대기 중이면 텍스트를 피드백으로 처리
  if (pendingPlanRejection) {
    const rejection = pendingPlanRejection;
    pendingPlanRejection = null;
    log(`[PLAN] 거부 피드백: ${prompt}`);
    rejection.resolve({ feedback: prompt });
    return;
  }

  // AskUserQuestion "직접 입력" 대기 중이면 텍스트를 응답으로 처리
  if (pendingSdkAsk && pendingSdkAsk.waitingTextInput) {
    const ctx = pendingSdkAsk;
    pendingSdkAsk = null;
    // 원래 질문 메시지 업데이트
    if (ctx.askMessageId) {
      bot.editMessageText(
        `❓ ${ctx.question}\n➡️ ${prompt}`,
        { chat_id: chatId, message_id: ctx.askMessageId }
      ).catch(() => {});
    }
    log(`[ASK] 직접 입력 응답: ${prompt}`);
    ctx.resolve(prompt);
    return;
  }

  // 대기 중인 사진이 있으면 텍스트와 합쳐서 처리
  if (pendingPhoto) {
    processPendingPhoto(prompt);
    return;
  }

  // 처리 중이면 대기열에 추가
  if (isProcessing) {
    messageQueue.push({ chatId, prompt });
    await bot.sendMessage(chatId, t("queue_added", { pos: messageQueue.length }), { disable_notification: true });
    return;
  }

  // 플랜 모드 강제 적용
  let finalPrompt = prompt;
  if (forcePlanMode) {
    forcePlanMode = false;
    finalPrompt = t("plan_force_prefix") + prompt;
  }

  processMessage(chatId, finalPrompt);
});

// ─── 네트워크 상태 관리 + 에러 핸들링 ────────────────────────────
let lastPollingErrorTime = 0;
let pollingErrorCount = 0;
let consecutivePollingErrors = 0;
let isOffline = false;
let reconnectTimer = null;
const OFFLINE_THRESHOLD = 5; // 연속 에러 N회 후 오프라인 전환
const RECONNECT_BASE_DELAY = CONFIG.RECONNECT_BASE_DELAY;
const RECONNECT_MAX_DELAY = CONFIG.RECONNECT_MAX_DELAY;

bot.on("polling_error", (err) => {
  const now = Date.now();
  pollingErrorCount++;
  consecutivePollingErrors++;

  // 30초에 한 번만 로그 출력
  if (now - lastPollingErrorTime >= 30000) {
    if (pollingErrorCount > 1) {
      logError(`[POLLING ERROR] ${err.message} (${pollingErrorCount}회 반복)`);
    } else {
      logError(`[POLLING ERROR] ${err.message}`);
    }
    pollingErrorCount = 0;
    lastPollingErrorTime = now;
  }

  // 연속 에러 임계치 도달 → 오프라인 모드 전환
  if (consecutivePollingErrors >= OFFLINE_THRESHOLD && !isOffline) {
    isOffline = true;
    log("[OFFLINE] 네트워크 연결 끊김 감지. 폴링 중지 후 재연결 대기...");
    bot.stopPolling();
    scheduleReconnect(RECONNECT_BASE_DELAY);
  }
});

// 메시지 수신 성공 시 에러 카운터 리셋
bot.on("message", () => {
  consecutivePollingErrors = 0;
});

function scheduleReconnect(delay) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    log(`[RECONNECT] 재연결 시도 중... (${delay / 1000}초 대기 후)`);
    try {
      await bot.getMe(); // 연결 테스트
      await bot.startPolling();
      isOffline = false;
      consecutivePollingErrors = 0;
      pollingErrorCount = 0;
      log("[ONLINE] 네트워크 재연결 성공!");
      if (AUTHORIZED_USER_ID) {
        bot.sendMessage(AUTHORIZED_USER_ID, t("reconnected")).catch(() => {});
      }
    } catch (err) {
      const nextDelay = Math.min(delay * 2, RECONNECT_MAX_DELAY);
      log(`[RECONNECT] 실패 (${err.message}). ${nextDelay / 1000}초 후 재시도...`);
      scheduleReconnect(nextDelay);
    }
  }, delay);
}

// ─── 종료 처리 ───────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  log(`[INFO] ${signal} 수신 — 봇을 종료합니다...`);

  if (reconnectTimer) clearTimeout(reconnectTimer);

  if (currentAbortController) {
    currentAbortController.abort();
  }

  // Preview 서버/터널/Webhook 정리
  stopTunnel();
  if (webhookServer) { webhookServer.close(); webhookServer = null; }
  // Cron 작업 중지
  for (const [, entry] of cronJobs) { try { entry.job.stop(); } catch {} }

  if (AUTHORIZED_USER_ID) {
    await bot.sendMessage(AUTHORIZED_USER_ID, t("bot_stopped")).catch(() => {});
  }

  bot.stopPolling();
  releaseLock();
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
process.on("exit", releaseLock);

process.on("uncaughtException", (err) => {
  logError(`[FATAL] uncaughtException: ${err.message}`);
  stopTunnel();
  if (webhookServer) { webhookServer.close(); webhookServer = null; }
  releaseLock();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logError(`[FATAL] unhandledRejection: ${reason}`);
});

// ─── 시작 알림 ────────────────────────────────────────────────────
async function sendStartupMessage() {
  if (!AUTHORIZED_USER_ID) return;

  try {
    // 이어받을 수 있는 세션 확인 (모든 프로젝트에서)
    const sessions = findRecentSessions(workingDir, 3);
    const recent = sessions[0];

    let text = t("bot_started", { name: COMPUTER_NAME, dir: workingDir });

    if (recent) {
      const ago = Date.now() - recent.mtime.getTime();
      const mins = Math.floor(ago / 60000);
      const timeAgo = mins < 60
        ? t("time_ago_min", { n: mins })
        : mins < 1440
          ? t("time_ago_hour", { n: Math.floor(mins / 60) })
          : t("time_ago_day", { n: Math.floor(mins / 1440) });
      const dirTag = recent.dirLabel ? `[${recent.dirLabel}] ` : "";
      if (recent.active) {
        text += t("active_session_startup", { dirTag, preview: recent.preview || t("content_empty") });
      } else {
        text += t("recent_session_startup", { dirTag, timeAgo, preview: recent.preview || "" });
      }
    }

    await bot.sendMessage(AUTHORIZED_USER_ID, text, { parse_mode: "Markdown" });

    // 권한 모드 + 이어받기 버튼
    const buttons = [[
      { text: t("btn_safe_mode_short"), callback_data: "perm_safe" },
      { text: t("btn_skip_mode"), callback_data: "perm_skip" },
    ]];
    if (recent && recent.active) {
      buttons.push([{ text: t("btn_resume_active_session"), callback_data: "resume_startup" }]);
    } else if (recent) {
      buttons.push([{ text: t("btn_resume_prev_session"), callback_data: "resume_startup" }]);
    }

    await bot.sendMessage(AUTHORIZED_USER_ID, t("select_perm_mode"), {
      reply_markup: { inline_keyboard: buttons },
    });
  } catch {}
}

// ─── SDK 로드 후 시작 ────────────────────────────────────────────
loadSDK().then(() => sendStartupMessage());
