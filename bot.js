require("dotenv").config();
delete process.env.CLAUDECODE; // SDK가 중첩 세션 감지하지 않도록
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec } = require("child_process");
const express = require("express");

// ─── 파일 로깅 ──────────────────────────────────────────────────
const LOG_FILE = path.join(process.cwd(), "bot.log");

// 로그 파일 초기화 (최대 1MB 넘으면 리셋)
try {
  if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) {
    fs.writeFileSync(LOG_FILE, "");
  }
} catch {}

function writeLogLine(line) {
  try {
    const existing = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf-8") : "";
    fs.writeFileSync(LOG_FILE, line + "\n" + existing);
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
const AUTHORIZED_USER_ID = process.env.AUTHORIZED_USER_ID
  ? Number(process.env.AUTHORIZED_USER_ID)
  : null;

const COMPUTER_NAME = process.env.COMPUTER_NAME || os.hostname();

if (!BOT_TOKEN || BOT_TOKEN === "your_bot_token_here") {
  logError("[ERROR] TELEGRAM_BOT_TOKEN이 설정되지 않았습니다. .env 파일을 확인하세요.");
  process.exit(1);
}

if (!AUTHORIZED_USER_ID) {
  log("[WARN] AUTHORIZED_USER_ID가 설정되지 않았습니다. /start로 유저 ID를 확인한 뒤 .env에 설정하세요.");
}

// ─── 봇 초기화 ───────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.setMyCommands([
  { command: "start", description: "봇 시작 + 유저 ID 안내" },
  { command: "new", description: "새 세션 시작" },
  { command: "status", description: "현재 상태 (세션, 디렉토리)" },
  { command: "setdir", description: "작업 디렉토리 변경" },
  { command: "cancel", description: "현재 작업 취소" },
  { command: "files", description: "파일 목록 보기" },
  { command: "read", description: "파일 내용 읽기" },
  { command: "preview", description: "파일 미리보기 (HTML/이미지/스크립트)" },
  { command: "tunnel", description: "터널 관리 (status/start/stop)" },
]);

log("[INFO] 봇이 시작되었습니다. 텔레그램에서 메시지를 보내보세요.");

// 시작 알림 + 즉시 권한 모드 선택
if (AUTHORIZED_USER_ID) {
  bot.sendMessage(AUTHORIZED_USER_ID, `🟢 봇이 켜졌습니다. [${COMPUTER_NAME}]`).then(() => {
    bot.sendMessage(AUTHORIZED_USER_ID, "권한 모드를 선택하세요:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔒 안전 모드 (기본)", callback_data: "perm_safe" },
            { text: "⚡ 전체 허용", callback_data: "perm_skip" },
          ],
        ],
      },
    });
  }).catch(() => {});
}

// ─── 상태 영속화 ─────────────────────────────────────────────────
const STATE_FILE = path.join(process.cwd(), "bot-state.json");

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      if (data.workingDir && fs.existsSync(data.workingDir)) {
        return data.workingDir;
      }
    }
  } catch {}
  return null;
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ workingDir }, null, 2));
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
let needsDirectoryChoice = false;
let pendingMessage = null;
let pendingSdkAsk = null;

// ─── Preview/Tunnel 상태 ────────────────────────────────────────
const PREVIEW_PORT = 18923;
let expressServer = null;
let tunnelProcess = null;
let tunnelUrl = null;

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
const MAX_MSG_LENGTH = 4096;

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
    await safeSend(chatId, "(빈 응답)", options);
    return;
  }

  if (text.length <= MAX_MSG_LENGTH) {
    await safeSend(chatId, text, options);
    return;
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

// ─── 자연어 디렉토리 해석 ─────────────────────────────────────────
function resolveDirectory(description) {
  // 1. 직접 경로로 시도
  const direct = path.resolve(description.trim());
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }

  // 2. 한국어 위치 키워드 → 실제 경로 매핑
  const home = os.homedir();
  const locationMap = [
    { keywords: ["바탕화면", "바탕 화면", "데스크톱", "desktop"], paths: [path.join(home, "OneDrive", "바탕 화면"), path.join(home, "Desktop")] },
    { keywords: ["문서", "도큐먼트", "documents"], paths: [path.join(home, "OneDrive", "문서"), path.join(home, "Documents")] },
    { keywords: ["다운로드", "downloads"], paths: [path.join(home, "Downloads")] },
    { keywords: ["홈", "home"], paths: [home] },
  ];

  const desc = description.toLowerCase().trim();
  let basePaths = [];
  let folderName = desc;

  for (const loc of locationMap) {
    const found = loc.keywords.find((kw) => desc.includes(kw));
    if (found) {
      basePaths = loc.paths;
      // 키워드 제거 + 한국어 조사/접미사 정리
      folderName = desc
        .replace(found, "")
        .replace(/[의에서]\s*/g, " ")
        .replace(/\s*(폴더|디렉토리|프로젝트|레포|repo)\s*/g, " ")
        .replace(/\s*(에서|에|로|으로)\s*(작업|시작|열어|가자|하자|해줘).*$/g, "")
        .trim();
      break;
    }
  }

  // 위치 키워드 없으면 주요 경로에서 검색
  if (basePaths.length === 0) {
    basePaths = [
      path.join(home, "OneDrive", "바탕 화면"),
      path.join(home, "Desktop"),
      path.join(home, "Documents"),
      path.join(home, "OneDrive", "문서"),
      home,
    ];
    folderName = desc
      .replace(/\s*(폴더|디렉토리|프로젝트|레포|repo)\s*/g, " ")
      .replace(/\s*(에서|에|로|으로)\s*(작업|시작|열어|가자|하자|해줘).*$/g, "")
      .trim();
  }

  if (!folderName || folderName.length > 40) return null;

  // 3. 각 기본 경로에서 폴더 검색
  for (const base of basePaths) {
    if (!fs.existsSync(base)) continue;

    // 정확히 일치
    const exact = path.join(base, folderName);
    if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) {
      return exact;
    }

    // 대소문자 무시 검색 (정확 일치 또는 폴더이름이 검색어를 포함)
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toLowerCase();
        if (name === folderName || name.includes(folderName)) {
          return path.join(base, entry.name);
        }
      }
    } catch {}
  }

  return null;
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

    // 선택지를 인라인 키보드로 변환 (2열 배치)
    const buttons = question.options.map((opt, i) => ({
      text: opt.label,
      callback_data: `sdk_ask_${i}`,
    }));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2));
    }

    pendingSdkAsk = {
      resolve: (answer) => {
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
    };

    const isPlan = toolName === "ExitPlanMode";
    const icon = isPlan ? "📋" : (TOOL_ICONS[toolName] || "🔧");
    let text = isPlan
      ? `📋 **계획 승인 요청**\n\n${detail}`
      : `🔒 도구 승인 요청\n\n${icon} **${toolName}**`;
    if (!isPlan && detail) text += `\n${detail}`;

    const buttons = isPlan
      ? [
          { text: "✅ 승인 — 진행", callback_data: "tool_approve_yes" },
          { text: "❌ 수정 필요", callback_data: "tool_approve_no" },
        ]
      : [
          { text: "✅ 허용", callback_data: "tool_approve_yes" },
          { text: "❌ 거부", callback_data: "tool_approve_no" },
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

  // ExitPlanMode → 전체 허용이면 자동 승인, 안전 모드면 텔레그램 승인 요청
  if (toolName === "ExitPlanMode") {
    if (skipPermissions) {
      log("[PLAN] 플랜 모드 종료 (자동 승인)");
      return { behavior: "allow", updatedInput: input };
    }
    try {
      log("[PLAN] 플랜 모드 종료 승인 요청");
      const allowed = await askToolApproval("ExitPlanMode", "📋 위 계획을 승인하시겠습니까?", signal);
      if (allowed) {
        log("[PLAN] 계획 승인됨 → 구현 시작");
        return { behavior: "allow", updatedInput: input };
      } else {
        log("[PLAN] 계획 거부됨");
        return { behavior: "deny", message: "사용자가 계획을 거부했습니다. 수정이 필요합니다." };
      }
    } catch (err) {
      return { behavior: "deny", message: err.message || "계획 승인 요청 실패" };
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
      return { behavior: "deny", message: "사용자가 도구 사용을 거부했습니다." };
    }
  } catch (err) {
    return { behavior: "deny", message: err.message || "도구 승인 요청 실패" };
  }
}

// ─── Claude Code SDK 실행 ────────────────────────────────────────
async function runClaude(prompt, chatId) {
  if (!sdkQuery) {
    throw new Error("SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도하세요.");
  }

  const abortController = new AbortController();
  currentAbortController = abortController;

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
        "- Respond in the same language the user uses.",
      ].join("\n"),
    },
    tools: { type: "preset", preset: "claude_code" },
    abortController,
    canUseTool: handleToolPermission,
  };

  // 기존 세션이 있으면 대화 이어가기
  if (sessionId) {
    options.resume = sessionId;
  }

  log(`[SDK] query() 호출 — prompt: "${prompt.substring(0, 80)}..." session: ${sessionId || "(새 세션)"}`);

  try {
    const q = sdkQuery({ prompt, options });

    let resultText = "";
    let newSessionId = null;
    let progressMsgId = null;
    let lastProgressUpdate = 0;
    let sentIntermediateText = false;

    for await (const message of q) {
      if (message.session_id) {
        newSessionId = message.session_id;
      }

      // assistant 메시지 처리: 텍스트 전송 + 도구 진행 표시
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          // 중간 텍스트 → 바로 텔레그램에 전송
          if (block.type === "text" && block.text?.trim()) {
            // 진행 메시지가 있으면 먼저 삭제
            if (progressMsgId) {
              try { await bot.deleteMessage(chatId, progressMsgId); } catch {}
              progressMsgId = null;
            }
            await sendLongMessage(chatId, block.text, { parse_mode: "Markdown" });
            sentIntermediateText = true;
          }

          if (block.type === "tool_use") {
            const now = Date.now();
            if (now - lastProgressUpdate >= 1500) {
              const icon = TOOL_ICONS[block.name] || "🔧";
              const detail = block.name === "Bash"
                ? ` \`${(block.input?.command || "").substring(0, 60)}\``
                : block.name === "Read" || block.name === "Edit" || block.name === "Write"
                ? ` \`${(block.input?.file_path || "").split(/[/\\]/).pop()}\``
                : "";
              try {
                if (progressMsgId) {
                  await bot.editMessageText(`${icon} ${block.name}${detail}`, {
                    chat_id: chatId, message_id: progressMsgId, parse_mode: "Markdown",
                  });
                } else {
                  const sent = await bot.sendMessage(chatId, `${icon} ${block.name}${detail}`, { parse_mode: "Markdown" });
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

        if (message.subtype === "success") {
          // 중간에 이미 텍스트를 보냈으면 최종 결과는 생략 (중복 방지)
          resultText = sentIntermediateText ? "" : (message.result || "(빈 응답)");
        } else {
          const errors = message.errors?.join("\n") || "알 수 없는 오류";
          resultText = `❌ 오류: ${errors}`;
        }

        log(`[SDK] 완료 — turns: ${message.num_turns}, cost: $${message.total_cost_usd?.toFixed(4) || "?"}`);
      }
    }

    // 세션 ID 저장 (다음 대화에서 resume 용)
    if (newSessionId) {
      sessionId = newSessionId;
    }

    return resultText;
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
    exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n" : "") + stderr;
      if (err && !output) output = err.message;
      resolve(output || "(출력 없음)");
    });
  });
}

// 스크립트 실행 후 3초 내 종료 → stdout, 아직 실행 중 → GUI로 판단 → 스크린샷
function runScriptSmart(command, cwd) {
  return new Promise((resolve) => {
    const child = exec(command, { cwd, maxBuffer: 1024 * 1024 });

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
        resolve({ type: "text", output: output || "(출력 없음)" });
      } else {
        // GUI 스크립트: 스크린샷
        resolve({ type: "gui", child });
      }
    }, 3000);
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
      `안녕하세요, ${userName}님!\n\n` +
        `당신의 Telegram 유저 ID: \`${userId}\`\n\n` +
        `.env 파일에 다음을 추가한 뒤 봇을 재시작하세요:\n` +
        `\`AUTHORIZED_USER_ID=${userId}\``,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (!isAuthorized(msg)) {
    await bot.sendMessage(chatId, "⛔ 인증되지 않은 사용자입니다.");
    return;
  }

  await bot.sendMessage(
    chatId,
    `✅ 인증 완료! Claude Code Remote Controller 준비됨.\n\n` +
      `세션 ID: \`${sessionId || "(아직 없음)"}\`\n` +
      `작업 디렉토리: \`${workingDir}\`\n\n` +
      `명령어 목록:\n` +
      `/new - 새 세션 시작\n` +
      `/status - 현재 상태\n` +
      `/setdir <경로> - 작업 디렉토리 변경\n` +
      `/cancel - 현재 작업 취소\n` +
      `/files - 파일 목록\n` +
      `/read <파일> - 파일 내용 읽기\n` +
      `/preview <파일> - 파일 미리보기\n` +
      `/tunnel - 터널 관리\n\n` +
      `일반 메시지를 보내면 Claude Code에 전달됩니다.`,
    { parse_mode: "Markdown" }
  );
});

// /new - 새 세션 시작
bot.onText(/\/new/, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;

  sessionId = null;
  skipPermissions = false;
  needsPermissionChoice = true;
  needsDirectoryChoice = false;

  await bot.sendMessage(
    chatId,
    `🆕 새 세션이 시작되었습니다.\n\n권한 모드를 선택하세요:`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔒 안전 모드 (기본)", callback_data: "perm_safe" },
            { text: "⚡ 전체 허용", callback_data: "perm_skip" },
          ],
        ],
      },
    }
  );
});

// 콜백 쿼리 핸들러 (권한 모드 선택 + AskUserQuestion 응답)
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  // 권한 모드 선택
  if (query.data === "perm_safe" || query.data === "perm_skip") {
    skipPermissions = query.data === "perm_skip";
    needsPermissionChoice = false;
    needsDirectoryChoice = true;
    await bot.answerCallbackQuery(query.id);
    const modeText = skipPermissions ? "⚡ 전체 허용 모드" : "🔒 안전 모드";
    await bot.editMessageText(
      `${modeText}로 설정되었습니다.`,
      { chat_id: chatId, message_id: query.message.message_id }
    );
    log(`[MODE] ${modeText}`);
    await bot.sendMessage(
      chatId,
      `📂 작업 디렉토리: \`${workingDir}\`\n\n변경하려면 경로를 입력하세요.\n바로 작업하려면 메시지를 보내세요.`,
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
    await bot.editMessageText(
      approved
        ? `✅ 도구 사용이 허용되었습니다.`
        : `❌ 도구 사용이 거부되었습니다.`,
      { chat_id: chatId, message_id: query.message.message_id }
    );
    pendingToolApproval.resolve(approved);
    return;
  } else if (query.data.startsWith("sdk_ask_") && pendingSdkAsk) {
    // AskUserQuestion 응답 처리
    const idx = parseInt(query.data.replace("sdk_ask_", ""), 10);
    const ctx = pendingSdkAsk;
    const selected = ctx.options[idx];

    if (!selected) {
      await bot.answerCallbackQuery(query.id, { text: "잘못된 선택입니다." });
      return;
    }

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
  if (!needsPermissionChoice && !needsDirectoryChoice && pendingMessage) {
    const saved = pendingMessage;
    pendingMessage = null;
    bot.emit("message", saved);
  }
});

// /status - 현재 상태
bot.onText(/\/status/, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    `📊 현재 상태\n\n` +
      `세션 ID: \`${sessionId || "(없음)"}\`\n` +
      `작업 디렉토리: \`${workingDir}\`\n` +
      `처리 중: ${isProcessing ? "⏳ 예" : "✅ 아니오"}\n` +
      `권한 모드: ${skipPermissions ? "⚡ 전체 허용" : "🔒 안전"}`,
    { parse_mode: "Markdown" }
  );
});

// /setdir <path> - 작업 디렉토리 변경
bot.onText(/\/setdir(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const newDir = match[1]?.trim();

  if (!newDir) {
    await bot.sendMessage(
      chatId,
      `현재 작업 디렉토리: \`${workingDir}\`\n\n사용법: \`/setdir <경로>\``,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const resolved = path.resolve(newDir);

  if (!fs.existsSync(resolved)) {
    await bot.sendMessage(chatId, `❌ 디렉토리가 존재하지 않습니다: \`${resolved}\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  workingDir = resolved;
  saveState();
  // 서버가 실행 중이면 재시작 (새 디렉토리 서빙)
  if (expressServer) {
    stopPreviewServer();
    startPreviewServer();
    log("[PREVIEW] Server restarted for new workingDir");
  }
  await bot.sendMessage(
    chatId,
    `📂 작업 디렉토리 변경됨: \`${workingDir}\``,
    { parse_mode: "Markdown" }
  );
});

// /cancel - 현재 작업 취소
bot.onText(/\/cancel/, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    isProcessing = false;
    // 대기 중인 AskUserQuestion도 취소
    pendingSdkAsk = null;
    await bot.sendMessage(chatId, "🛑 현재 작업이 취소되었습니다.");
  } else {
    await bot.sendMessage(chatId, "실행 중인 작업이 없습니다.");
  }
});

// /files - 현재 디렉토리 파일 목록
bot.onText(/\/files/, async (msg) => {
  if (!isAuthorized(msg)) return;
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
      `📂 \`${workingDir}\`\n\n${list || "(빈 디렉토리)"}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await bot.sendMessage(chatId, `❌ 오류: ${err.message}`);
  }
});

// /read <file> - 파일 내용 읽기
bot.onText(/\/read(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const fileName = match[1]?.trim();

  if (!fileName) {
    await bot.sendMessage(chatId, "사용법: `/read <파일명>`", {
      parse_mode: "Markdown",
    });
    return;
  }

  const filePath = path.resolve(workingDir, fileName);

  // Path Traversal 방지: 작업 디렉토리 밖의 파일 접근 차단
  if (!filePath.startsWith(workingDir)) {
    await bot.sendMessage(chatId, "⛔ 작업 디렉토리 밖의 파일에는 접근할 수 없습니다.");
    return;
  }

  if (!fs.existsSync(filePath)) {
    await bot.sendMessage(chatId, `❌ 파일을 찾을 수 없습니다: \`${fileName}\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      await bot.sendMessage(chatId, `❌ \`${fileName}\`은(는) 디렉토리입니다.`, {
        parse_mode: "Markdown",
      });
      return;
    }

    // 바이너리 파일 체크 (1MB 이상이면 경고)
    if (stat.size > 1024 * 1024) {
      await bot.sendMessage(
        chatId,
        `❌ 파일이 너무 큽니다 (${(stat.size / 1024 / 1024).toFixed(1)}MB). 1MB 이하 파일만 읽을 수 있습니다.`
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
    await bot.sendMessage(chatId, `❌ 파일 읽기 오류: ${err.message}`);
  }
});

// /preview <file> - 파일 미리보기
bot.onText(/\/preview(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const fileName = match[1]?.trim();

  if (!fileName) {
    await bot.sendMessage(chatId, "사용법: `/preview <파일명>`\n\nHTML → 터널 링크, 이미지 → 사진, 스크립트 → 실행 결과", {
      parse_mode: "Markdown",
    });
    return;
  }

  const filePath = path.resolve(workingDir, fileName);

  // Path Traversal 방지
  if (!filePath.startsWith(workingDir)) {
    await bot.sendMessage(chatId, "⛔ 작업 디렉토리 밖의 파일에는 접근할 수 없습니다.");
    return;
  }

  if (!fs.existsSync(filePath)) {
    await bot.sendMessage(chatId, `❌ 파일을 찾을 수 없습니다: \`${fileName}\``, {
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
      await bot.sendMessage(chatId, `🌐 미리보기 링크:\n${previewUrl}\n\n터널 종료: /tunnel stop`);

    } else if (category === "image") {
      // Image: send as photo
      await bot.sendChatAction(chatId, "upload_photo");
      await bot.sendPhoto(chatId, filePath, { caption: `📷 ${fileName}` });

    } else if (category === "executable") {
      // EXE: run → wait 3s → screenshot → send
      await bot.sendMessage(chatId, `▶️ \`${fileName}\` 실행 중...`, { parse_mode: "Markdown" });
      exec(`"${filePath}"`, { cwd: workingDir });
      await new Promise((r) => setTimeout(r, 3000));
      const screenshotPath = path.join(os.tmpdir(), `preview_${Date.now()}.png`);
      await takeScreenshot(screenshotPath);
      await bot.sendChatAction(chatId, "upload_photo");
      await bot.sendPhoto(chatId, screenshotPath, { caption: `📸 ${fileName} 실행 후 스크린샷` });
      try { fs.unlinkSync(screenshotPath); } catch {}

    } else if (category === "script") {
      // Script: 3초 내 종료 → stdout, GUI면 → 스크린샷
      const runner = getScriptRunner(filePath);
      await bot.sendMessage(chatId, `▶️ \`${fileName}\` 실행 중...`, { parse_mode: "Markdown" });
      const result = await runScriptSmart(`${runner} "${filePath}"`, workingDir);
      if (result.type === "text") {
        const trimmed = result.output.length > 4000 ? result.output.substring(0, 4000) + "\n...(잘림)" : result.output;
        await sendLongMessage(chatId, `💻 \`${fileName}\` 실행 결과:\n\`\`\`\n${trimmed}\n\`\`\``, {
          parse_mode: "Markdown",
        });
      } else {
        // GUI 앱: 스크린샷 촬영 후 프로세스 종료
        const screenshotPath = path.join(os.tmpdir(), `preview_${Date.now()}.png`);
        await takeScreenshot(screenshotPath);
        await bot.sendChatAction(chatId, "upload_photo");
        await bot.sendPhoto(chatId, screenshotPath, { caption: `📸 ${fileName} (GUI)` });
        try { fs.unlinkSync(screenshotPath); } catch {}
        try { result.child.kill(); } catch {}
      }

    } else {
      // Other: send as document
      const stat = fs.statSync(filePath);
      if (stat.size > 50 * 1024 * 1024) {
        await bot.sendMessage(chatId, `❌ 파일이 너무 큽니다 (${(stat.size / 1024 / 1024).toFixed(1)}MB). 50MB 이하만 전송 가능합니다.`);
        return;
      }
      await bot.sendChatAction(chatId, "upload_document");
      await bot.sendDocument(chatId, filePath, { caption: `📎 ${fileName}` });
    }
  } catch (err) {
    await bot.sendMessage(chatId, `❌ 미리보기 오류: ${err.message}`);
  }
});

// /tunnel [status|start|stop] - 터널 관리
bot.onText(/\/tunnel(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const action = (match[1] || "status").trim().toLowerCase();

  if (action === "status") {
    if (tunnelUrl) {
      await bot.sendMessage(chatId, `🟢 터널 활성\n🌐 ${tunnelUrl}\n\n종료: /tunnel stop`);
    } else {
      await bot.sendMessage(chatId, "⚪ 터널 비활성\n\n시작: /tunnel start");
    }
  } else if (action === "start") {
    if (tunnelUrl) {
      await bot.sendMessage(chatId, `🟢 이미 활성 상태입니다.\n🌐 ${tunnelUrl}`);
      return;
    }
    try {
      await bot.sendMessage(chatId, "⏳ 터널 시작 중...");
      const url = await startTunnel();
      await bot.sendMessage(chatId, `🟢 터널 시작됨!\n🌐 ${url}\n\n종료: /tunnel stop`);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ 터널 시작 실패: ${err.message}`);
    }
  } else if (action === "stop") {
    if (!tunnelUrl && !tunnelProcess) {
      await bot.sendMessage(chatId, "⚪ 터널이 이미 비활성 상태입니다.");
      return;
    }
    stopTunnel();
    await bot.sendMessage(chatId, "🔴 터널이 종료되었습니다.");
  } else {
    await bot.sendMessage(chatId, "사용법: `/tunnel [status|start|stop]`", { parse_mode: "Markdown" });
  }
});

// ─── 일반 메시지 처리 (Claude Code에 전달) ───────────────────────

async function processMessage(chatId, prompt) {
  isProcessing = true;

  // typing indicator
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, "typing").catch(() => {});
  }, 4000);

  try {
    const response = await runClaude(prompt, chatId);

    log(`[USER] ${prompt}`);
    log(`[CLAUDE] ${response.substring(0, 200)}${response.length > 200 ? "..." : ""}`);
    log("─".repeat(50));

    if (response) {
      await sendLongMessage(chatId, response, { parse_mode: "Markdown" });
    }
  } catch (err) {
    // 취소된 경우 무시
    if (err.name === "AbortError" || err.message?.includes("abort")) {
      log("[INFO] 작업이 취소되었습니다.");
      return;
    }

    let errorMsg = `❌ Claude Code 오류:\n\`\`\`\n${err.message}\n\`\`\``;

    if (err.message.includes("ENOENT") || err.message.includes("not found")) {
      errorMsg +=
        "\n\n💡 Claude Agent SDK가 올바르게 설치되어 있는지 확인하세요.";
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

bot.on("message", async (msg) => {
  // 명령어는 무시 (위의 핸들러에서 처리)
  if (msg.text && msg.text.startsWith("/")) return;
  if (!msg.text) return;
  if (!isAuthorized(msg)) {
    if (!AUTHORIZED_USER_ID) {
      await bot.sendMessage(
        msg.chat.id,
        `유저 ID: \`${msg.from.id}\`\n.env에 AUTHORIZED_USER_ID를 설정하세요.`,
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  const chatId = msg.chat.id;
  const prompt = msg.text;

  // 첫 메시지 시 권한 모드 선택
  if (needsPermissionChoice) {
    pendingMessage = msg;
    await bot.sendMessage(
      chatId,
      "먼저 권한 모드를 선택하세요:",
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔒 안전 모드 (기본)", callback_data: "perm_safe" },
              { text: "⚡ 전체 허용", callback_data: "perm_skip" },
            ],
          ],
        },
      }
    );
    return;
  }

  // 디렉토리 선택 대기 중 — 경로면 변경, 아니면 기존 디렉토리로 바로 작업 시작
  if (needsDirectoryChoice) {
    const resolved = resolveDirectory(prompt);
    needsDirectoryChoice = false;

    if (resolved) {
      workingDir = resolved;
      saveState();
      await bot.sendMessage(chatId, `📂 작업 디렉토리: \`${workingDir}\``, { parse_mode: "Markdown" });
      log(`[DIR] ${workingDir}`);
      return; // 디렉토리만 변경, 다음 메시지 대기
    }
    // 디렉토리가 아님 → 기존 디렉토리 유지하고 이 메시지를 Claude에 전달
    log(`[DIR] 기존 유지: ${workingDir}`);
  }

  // 처리 중이면 대기열에 추가
  if (isProcessing) {
    messageQueue.push({ chatId, prompt });
    await bot.sendMessage(chatId, `📋 대기열에 추가됨 (${messageQueue.length}번째)`);
    return;
  }

  processMessage(chatId, prompt);
});

// ─── 네트워크 상태 관리 + 에러 핸들링 ────────────────────────────
let lastPollingErrorTime = 0;
let pollingErrorCount = 0;
let consecutivePollingErrors = 0;
let isOffline = false;
let reconnectTimer = null;
const OFFLINE_THRESHOLD = 5; // 연속 에러 N회 후 오프라인 전환
const RECONNECT_BASE_DELAY = 10000; // 10초
const RECONNECT_MAX_DELAY = 300000; // 5분

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
        bot.sendMessage(AUTHORIZED_USER_ID, "🟢 네트워크 재연결됨. 정상 동작합니다.").catch(() => {});
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

  // Preview 서버/터널 정리
  stopTunnel();

  if (AUTHORIZED_USER_ID) {
    await bot.sendMessage(AUTHORIZED_USER_ID, "🔴 봇이 꺼졌습니다.").catch(() => {});
  }

  bot.stopPolling();
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

// ─── SDK 로드 후 시작 ────────────────────────────────────────────
loadSDK();
