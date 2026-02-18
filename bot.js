require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

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

if (!BOT_TOKEN || BOT_TOKEN === "your_bot_token_here") {
  console.error(
    "[ERROR] TELEGRAM_BOT_TOKEN이 설정되지 않았습니다. .env 파일을 확인하세요."
  );
  process.exit(1);
}

if (!AUTHORIZED_USER_ID) {
  console.warn(
    "[WARN] AUTHORIZED_USER_ID가 설정되지 않았습니다. /start로 유저 ID를 확인한 뒤 .env에 설정하세요."
  );
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
]);

console.log("[INFO] 봇이 시작되었습니다. 텔레그램에서 메시지를 보내보세요.");

// ─── 상태 관리 ───────────────────────────────────────────────────
let sessionId = crypto.randomUUID();
let workingDir = process.cwd();
let currentProcess = null;
let isProcessing = false;

// ─── 인증 미들웨어 ───────────────────────────────────────────────
function isAuthorized(msg) {
  const userId = msg.from.id;

  // AUTHORIZED_USER_ID가 미설정이면 누구나 /start만 가능 (ID 확인용)
  if (!AUTHORIZED_USER_ID) {
    return false;
  }

  return userId === AUTHORIZED_USER_ID;
}

// ─── 메시지 분할 전송 ────────────────────────────────────────────
const MAX_MSG_LENGTH = 4096;

async function sendLongMessage(chatId, text, options = {}) {
  if (!text || text.length === 0) {
    await bot.sendMessage(chatId, "(빈 응답)", options);
    return;
  }

  if (text.length <= MAX_MSG_LENGTH) {
    await bot.sendMessage(chatId, text, options);
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
    await bot.sendMessage(chatId, header + chunks[i], options);
  }
}

// ─── Claude Code 실행 ────────────────────────────────────────────
function runClaude(prompt, chatId) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--session-id", sessionId,
    ];

    console.log(`[CMD] claude -p "${prompt.substring(0, 50)}..." --session-id ${sessionId}`);

    // Windows에서는 .cmd 파일 실행을 위해 process.platform 체크
    const isWindows = process.platform === "win32";

    const proc = spawn(isWindows ? "claude.cmd" : "claude", args, {
      cwd: workingDir,
      env: { ...process.env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    currentProcess = proc;
    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      currentProcess = null;

      if (stderr) console.log(`[STDERR] ${stderr}`);

      if (code !== 0 && code !== null) {
        console.error(`[ERROR] exit code ${code}`);
        reject(new Error(stderr || `프로세스가 코드 ${code}로 종료되었습니다.`));
        return;
      }

      console.log(`[OK] 응답 수신 (${stdout.length}자)`);
      resolve(stdout);
    });

    proc.on("error", (err) => {
      currentProcess = null;
      console.error(`[ERROR] ${err.message}`);
      reject(err);
    });
  });
}

// ─── Claude 응답 파싱 ────────────────────────────────────────────
function parseClaudeResponse(raw) {
  try {
    const json = JSON.parse(raw);
    // claude --output-format json 형식: { result: "..." } 또는 텍스트
    if (json.result) return json.result;
    if (json.text) return json.text;
    if (typeof json === "string") return json;
    return JSON.stringify(json, null, 2);
  } catch {
    // JSON 파싱 실패 시 원본 텍스트 반환
    return raw.trim() || "(응답 없음)";
  }
}

// ─── 명령어 핸들러 ───────────────────────────────────────────────

// /start - 봇 시작 + 유저 ID 안내
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name || "User";

  console.log(`[INFO] /start from user: ${userName} (ID: ${userId})`);

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
      `세션 ID: \`${sessionId}\`\n` +
      `작업 디렉토리: \`${workingDir}\`\n\n` +
      `명령어 목록:\n` +
      `/new - 새 세션 시작\n` +
      `/status - 현재 상태\n` +
      `/setdir <경로> - 작업 디렉토리 변경\n` +
      `/cancel - 현재 작업 취소\n` +
      `/files - 파일 목록\n` +
      `/read <파일> - 파일 내용 읽기\n\n` +
      `일반 메시지를 보내면 Claude Code에 전달됩니다.`,
    { parse_mode: "Markdown" }
  );
});

// /new - 새 세션 시작
bot.onText(/\/new/, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;

  sessionId = crypto.randomUUID();
  await bot.sendMessage(
    chatId,
    `🆕 새 세션이 시작되었습니다.\n세션 ID: \`${sessionId}\``,
    { parse_mode: "Markdown" }
  );
});

// /status - 현재 상태
bot.onText(/\/status/, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    `📊 현재 상태\n\n` +
      `세션 ID: \`${sessionId}\`\n` +
      `작업 디렉토리: \`${workingDir}\`\n` +
      `처리 중: ${isProcessing ? "⏳ 예" : "✅ 아니오"}`,
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

  if (currentProcess) {
    currentProcess.kill("SIGTERM");
    currentProcess = null;
    isProcessing = false;
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
    await bot.sendMessage(chatId, "⛔ 작업 디렉토리 밖의 파일에는 접근할 수 없습니다.", {
      parse_mode: "Markdown",
    });
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

// ─── 일반 메시지 처리 (Claude Code에 전달) ───────────────────────
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

  // 동시 요청 방지
  if (isProcessing) {
    await bot.sendMessage(
      chatId,
      "⏳ 이전 작업이 아직 처리 중입니다. 완료될 때까지 기다리거나 /cancel로 취소하세요."
    );
    return;
  }

  isProcessing = true;

  // typing indicator
  bot.sendChatAction(chatId, "typing");
  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, "typing");
  }, 4000);

  try {
    const raw = await runClaude(prompt, chatId);
    const response = parseClaudeResponse(raw);
    console.log(`[USER] ${prompt}`);
    console.log(`[CLAUDE] ${response}`);
    console.log("─".repeat(50));
    await sendLongMessage(chatId, response, { parse_mode: "Markdown" });
  } catch (err) {
    let errorMsg = `❌ Claude Code 오류:\n\`\`\`\n${err.message}\n\`\`\``;

    // 일반적인 오류 안내
    if (err.message.includes("ENOENT") || err.message.includes("not found")) {
      errorMsg +=
        "\n\n💡 `claude` CLI가 설치되어 있고 PATH에 등록되어 있는지 확인하세요.";
    }

    await sendLongMessage(chatId, errorMsg, { parse_mode: "Markdown" });
  } finally {
    clearInterval(typingInterval);
    isProcessing = false;
  }
});

// ─── 에러 핸들링 ─────────────────────────────────────────────────
bot.on("polling_error", (err) => {
  console.error("[POLLING ERROR]", err.message);
});

process.on("SIGINT", () => {
  console.log("\n[INFO] 봇을 종료합니다...");
  if (currentProcess) {
    currentProcess.kill("SIGTERM");
  }
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (currentProcess) {
    currentProcess.kill("SIGTERM");
  }
  bot.stopPolling();
  process.exit(0);
});
