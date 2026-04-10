// Design Ref: \u00a72.1 \u2014 \uba54\uc778 \ud30c\uc77c (Option C: Pragmatic)
// Plan SC: \uc544\ubc84\uc9c0\uac00 \ud63c\uc790\uc11c \uc9c8\ubb38\ud558\uace0 \ub2f5\ubcc0 \ubc1b\uc744 \uc218 \uc788\uc74c
require("dotenv").config();
delete process.env.CLAUDECODE;
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");
const CONFIG = require("./config");

// \u2500\u2500\u2500 \uc911\ubcf5 \uc2e4\ud589 \ubc29\uc9c0 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const LOCK_FILE = path.join(process.cwd(), "law-bot.lock");

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const oldPid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      if (oldPid && oldPid !== process.pid) {
        try {
          process.kill(oldPid, 0);
          // 프로세스가 살아있으면 종료 시도
          process.kill(oldPid, "SIGTERM");
          console.log(`기존 프로세스(${oldPid}) 종료 요청`);
        } catch { /* 프로세스 없음 — 정상 */ }
      }
      // 기존 lock 삭제 후 새로 생성 (Kill 후 잔여 lock 대응)
      try { fs.unlinkSync(LOCK_FILE); } catch {}
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
  } catch { /* 무시 */ }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* \ubb34\uc2dc */ }
}

acquireLock();

// \u2500\u2500\u2500 \ud658\uacbd \ubcc0\uc218 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let AUTHORIZED_USERS = (process.env.AUTHORIZED_USERS || "").split(",").map(s => s.trim()).filter(Boolean);
const ADMIN_ID = AUTHORIZED_USERS[0] || null; // 첫 번째 등록자 = 관리자

if (!BOT_TOKEN) { console.error("TELEGRAM_BOT_TOKEN\uc774 \uc124\uc815\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4."); process.exit(1); }
if (!process.env.LAW_OC) { console.error("LAW_OC(\ubc95\uc81c\ucc98 API \ud0a4)\uac00 \uc124\uc815\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4."); process.exit(1); }

// \u2500\u2500\u2500 \ud154\ub808\uadf8\ub7a8 \ubd07 \ucd08\uae30\ud654 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// \u2500\u2500\u2500 SDK \ub85c\ub529 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
let sdkQuery = null;
let createLawMcpServer = null;

async function loadSDK() {
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    sdkQuery = sdk.query;
    createLawMcpServer = require("./law-tools").createLawMcpServer;
    const lawMcp = createLawMcpServer(sdk);
    createLawMcpServer = () => lawMcp; // 캐시
    console.log("[SDK] Claude Agent SDK 로드 완료");
    console.log("[MCP] law-tools 6개 도구 등록 완료 (직접 법제처 API 호출)");
  } catch (err) {
    console.error(`[SDK] SDK 로드 실패: ${err.message}`);
    process.exit(1);
  }
}

// \u2500\u2500\u2500 \uc0c1\ud0dc \uad00\ub9ac \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const sessions = new Map();        // userId -> sessionId
const dailyUsage = new Map();      // userId -> { count, date }
let busyUsers = new Set();         // 질문 처리 중인 사용자
const pendingApprovals = new Set(); // 승인 요청 보낸 사용자 (중복 방지)

// \u2500\u2500\u2500 \uc778\uc99d \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Design Ref: \u00a75.4 \u2014 \uba40\ud2f0\uc720\uc800 \uc9c0\uc6d0
function isAuthorized(userId) {
  if (AUTHORIZED_USERS.length === 0) return true; // \ube48 \ubaa9\ub85d\uc774\uba74 \uc804\uccb4 \ud5c8\uc6a9
  return AUTHORIZED_USERS.includes(String(userId));
}

// \u2500\u2500\u2500 \uc0ac\uc6a9\ub7c9 \uc81c\ud55c \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Design Ref: \u00a78 \u2014 \uc0ac\uc6a9\ub7c9 \uc81c\ud55c
function checkDailyLimit(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const usage = dailyUsage.get(String(userId));
  if (!usage || usage.date !== today) {
    dailyUsage.set(String(userId), { count: 1, date: today });
    return true;
  }
  if (usage.count >= CONFIG.DAILY_QUERY_LIMIT) return false;
  usage.count++;
  return true;
}

// \u2500\u2500\u2500 \uc720\ud2f8 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function safeSend(chatId, text, opts = {}) {
  try {
    if (!text || text.trim().length === 0) return null;
    const maxLen = CONFIG.MAX_MSG_LENGTH - 100;
    if (text.length <= maxLen) {
      return await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...opts });
    }
    // \uae34 \ub2f5\ubcc0 \ubd84\ud560 \uc804\uc1a1
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt < maxLen * 0.3) splitAt = maxLen;
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt);
    }
    let lastMsg = null;
    for (const chunk of chunks) {
      lastMsg = await bot.sendMessage(chatId, chunk, { parse_mode: "Markdown", ...opts });
    }
    return lastMsg;
  } catch (err) {
    // Markdown \ud30c\uc2f1 \uc2e4\ud328 \uc2dc \ud50c\ub808\uc778 \ud14d\uc2a4\ud2b8\ub85c \uc7ac\uc2dc\ub3c4
    try { return await bot.sendMessage(chatId, text.substring(0, CONFIG.MAX_MSG_LENGTH)); }
    catch { return null; }
  }
}

// \u2500\u2500\u2500 \ubc95\ub960 \uc804\ubb38\uac00 \uc2dc\uc2a4\ud15c \ud504\ub86c\ud504\ud2b8 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Design Ref: \u00a73.1 \u2014 \uc2dc\uc2a4\ud15c \ud504\ub86c\ud504\ud2b8
const SYSTEM_PROMPT = [
  "당신은 한국 법률 정보 전문가입니다.",
  "",
  "역할:",
  "- 사용자의 법률 질문에 대해 관련 법령과 판례를 검색합니다",
  "- 검색된 법조항을 쉬운 한국어로 설명합니다",
  "- 반드시 관련 조문을 인용합니다",
  "",
  "사용 가능한 도구 (law-tools 6개):",
  "- search_law: 법령 검색 → get_law_text: 법령ID(MST)로 본문 조회",
  "- search_precedents: 판례 검색 → get_precedent_text: 판례ID로 본문 조회",
  "- search_admin_rule: 행정규칙 검색",
  "- search_ordinance: 조례 검색",
  "",
  "규칙:",
  "- 중요: 모든 도구는 이미 연결되어 있고 자동 승인됩니다. '권한', '승인', 'Allow', '허용' 등의 단어를 절대 사용하지 마세요",
  "- 도구 호출 오류 발생 시: 한 번 더 재시도하고, 그래도 실패하면 도구 없이 당신의 지식으로 답변하되 '일반 지식 기반 답변입니다'라고 짧게 안내하세요",
  "- 항상 쉬운 한국어로 답변합니다 (법률 용어는 괄호로 풀이)",
  "- 모든 답변 끝에 면책 고지를 포함합니다:",
  '  "⚠️ 이 정보는 법적 조언이 아닌 참고용 정보입니다. 정확한 법률 상담은 변호사와 상의하세요."',
  "- 테이블은 코드 블록(```)으로 작성합니다 (텔레그램 호환)",
  "- 검색 결과가 없으면 솔직히 알려줍니다",
  "- 단순 질문은 search_law → get_law_text 순서로 사용",
  "- 판례가 유용할 때는 search_precedents → get_precedent_text로 검색",
  "- 중요: search_law는 법령 '이름'으로 검색합니다. 주제어가 아닌 법령명 키워드를 사용하세요:",
  "  예: '육아휴직' → '남녀고용평등', '임대차' → '주택임대차보호법', '상속' → '민법'",
  "  검색 결과가 없으면 관련 법령명을 추론하여 다른 키워드로 재검색하세요",
  "- 답변에 Feature Usage, bkit, 시스템 리포트, 도구 사용 현황 등 메타 정보를 절대 포함하지 마세요",
  "- 답변은 면책 고지로 끝내세요. 그 이후에 아무것도 추가하지 마세요",
].join("\n");

// \u2500\u2500\u2500 Claude \ubc95\ub960 \uc9c8\ubb38 \uc2e4\ud589 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Design Ref: \u00a73.2 \u2014 Tool Use \ubc29\uc2dd
async function runLawQuery(prompt, chatId, userId) {
  if (!sdkQuery) throw new Error("SDK\uac00 \ub85c\ub4dc\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.");

  const abortController = new AbortController();

  const options = {
    systemPrompt: SYSTEM_PROMPT,
    tools: [],
    mcpServers: {
      "law-tools": createLawMcpServer(),
    },
    canUseTool: (_toolName, input) => ({ behavior: "allow", updatedInput: input }),
    maxBudgetUsd: CONFIG.DEFAULT_BUDGET,
    effort: CONFIG.DEFAULT_EFFORT,
    compaction: { enabled: true, contextTokenThreshold: CONFIG.COMPACTION_THRESHOLD },
    abortController,
  };

  // \uc138\uc158 \uc774\uc5b4\uac00\uae30
  const sessionId = sessions.get(String(userId));
  if (sessionId) {
    options.resume = sessionId;
  }

  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, "typing").catch(() => {});
  }, CONFIG.TYPING_INTERVAL);

  try {
    const q = sdkQuery({ prompt, options });

    let resultText = "";
    let newSessionId = null;

    for await (const message of q) {
      if (message.session_id) {
        newSessionId = message.session_id;
      }

      // assistant 메시지: 중간 텍스트 수집
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text) {
            resultText += block.text;
          } else if (block.type === "tool_use") {
            console.log(`[Tool] ${block.name}(${JSON.stringify(block.input).substring(0, 100)})`);
          }
        }
      }

      // 최종 결과
      if (message.type === "result") {
        if (message.subtype === "success" && message.result) {
          // 중간 텍스트가 없었으면 최종 결과 사용
          if (!resultText.trim()) resultText = message.result;
        }
      }
    }

    if (newSessionId) {
      sessions.set(String(userId), newSessionId);
    }

    return resultText.trim() || "답변을 생성하지 못했습니다. 다시 질문해주세요.";
  } finally {
    clearInterval(typingInterval);
  }
}

// ─── 미등록 사용자 승인 요청 ──────────────────────────────────────
async function requestApproval(chatId, userId, userName) {
  safeSend(chatId,
    `\ud83d\udc4b \uc548\ub155\ud558\uc138\uc694, ${userName}\ub2d8!\n\n` +
    `\ubc95\ub960 \ub3c4\uc6b0\ubbf8 \ubd07\uc785\ub2c8\ub2e4.\n` +
    `\uad00\ub9ac\uc790\uc5d0\uac8c \uc2b9\uc778 \uc694\uccad\uc744 \ubcf4\ub0c8\uc2b5\ub2c8\ub2e4. \uc7a0\uc2dc\ub9cc \uae30\ub2e4\ub824\uc8fc\uc138\uc694!`);
  if (ADMIN_ID && !pendingApprovals.has(String(userId))) {
    pendingApprovals.add(String(userId));
    await bot.sendMessage(ADMIN_ID,
      `\ud83d\udd14 *\uc0c8 \uc0ac\uc6a9\uc790 \uc2b9\uc778 \uc694\uccad*\n\n` +
      `\uc774\ub984: ${userName}\n` +
      `\uc720\uc800 ID: \`${userId}\`\n\n` +
      `\uc2b9\uc778\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          { text: "\u2705 \uc2b9\uc778", callback_data: `approve_${userId}` },
          { text: "\u274c \uac70\uc808", callback_data: `deny_${userId}` },
        ]] }
      });
  }
}

// \u2500\u2500\u2500 \uba85\ub839\uc5b4 \ud578\ub4e4\ub7ec \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const userName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "Unknown";
  if (!isAuthorized(userId)) {
    await requestApproval(msg.chat.id, userId, userName);
    return;
  }
  const welcome = [
    "\ud83d\udcda *\ubc95\ub960 \ub3c4\uc6b0\ubbf8 \ubd07*\uc5d0 \uc624\uc2e0 \uac83\uc744 \ud658\uc601\ud569\ub2c8\ub2e4!",
    "",
    `\ud83d\udc64 \uc720\uc800 ID: \`${userId}\``,
    "",
    "\ubc95\ub960 \uad00\ub828 \uad81\uae08\ud55c \uc810\uc744 \uc790\uc5f0\uc5b4\ub85c \uc9c8\ubb38\ud574\uc8fc\uc138\uc694.",
    "",
    "\uc608\uc2dc:",
    '\u2022 "\uc784\ub300\ucc28 \ubcf4\uc99d\uae08 \ubabb \ubc1b\uc73c\uba74 \uc5b4\ub5bb\uac8c \ud574?"',
    '\u2022 "\uad50\ud1b5\uc0ac\uace0 \ud569\uc758\uae08 \uae30\uc900\uc774 \uc5b4\ub5bb\uac8c \ub3fc?"',
    '\u2022 "\uc0c1\uc18d \ud3ec\uae30 \uc808\ucc28\uac00 \uc5b4\ub5bb\uac8c \ub418\ub098?"',
    "",
    "\uba85\ub839\uc5b4:",
    "/category \u2014 \ubd84\uc57c\ubcc4 \ube60\ub978 \uc9c8\ubb38",
    "/new \u2014 \uc0c8 \ub300\ud654 \uc2dc\uc791",
    "/help \u2014 \uc0ac\uc6a9\ubc95 \uc548\ub0b4",
    ...(String(userId) === ADMIN_ID ? ["/invite \u2014 \uc0ac\uc6a9\uc790 \ucd08\ub300 \uc548\ub0b4\ubb38 \ubcf4\uae30"] : []),
  ].join("\n");
  safeSend(msg.chat.id, welcome);
});

bot.onText(/\/help/, (msg) => {
  if (!isAuthorized(msg.from.id)) return;
  const help = [
    "\ud83d\udcd6 *\uc0ac\uc6a9\ubc95 \uc548\ub0b4*",
    "",
    "\ucc44\ud305\ucc3d\uc5d0 \ubc95\ub960 \uc9c8\ubb38\uc744 \uc785\ub825\ud558\uba74 \ub429\ub2c8\ub2e4.",
    "",
    "\ud83d\udca1 *\uc88b\uc740 \uc9c8\ubb38 \uc608\uc2dc:*",
    '\u2022 "\uc9c1\uc7a5\uc5d0\uc11c \ubd80\ub2f9\ud574\uace0 \ub2f9\ud588\ub294\ub370 \uc5b4\ub5bb\uac8c \ud574\uc57c \ud574?"',
    '\u2022 "\uc544\ud30c\ud2b8 \ub204\uc218 \uc190\ud574\ubc30\uc0c1 \uccad\uad6c \ubc29\ubc95"',
    '\u2022 "\uc774\ud63c \uc2dc \uc591\uc721\uad8c\uc740 \uc5b4\ub5bb\uac8c \uacb0\uc815\ub418\ub098?"',
    "",
    "\ubd07\uc774 \uad00\ub828 \ubc95\ub839\uacfc \ud310\ub840\ub97c \uac80\uc0c9\ud574\uc11c",
    "\uc26c\uc6b4 \ud55c\uad6d\uc5b4\ub85c \uc124\uba85\ud574\ub4dc\ub9bd\ub2c8\ub2e4.",
    "",
    "\u26a0\ufe0f \uc774 \ubd07\uc740 \ubc95\uc801 \uc870\uc5b8\uc774 \uc544\ub2cc \ucc38\uace0 \uc815\ubcf4\ub97c \uc81c\uacf5\ud569\ub2c8\ub2e4.",
  ].join("\n");
  safeSend(msg.chat.id, help);
});

bot.onText(/\/new/, (msg) => {
  if (!isAuthorized(msg.from.id)) return;
  sessions.delete(String(msg.from.id));
  safeSend(msg.chat.id, "\uc0c8 \ub300\ud654\ub97c \uc2dc\uc791\ud569\ub2c8\ub2e4. \uc9c8\ubb38\ud574\uc8fc\uc138\uc694!");
});

// \u2500\u2500\u2500 \uc0ac\uc6a9\uc790 \ucd08\ub300 \uc548\ub0b4 (\uad00\ub9ac\uc790 \uc804\uc6a9) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
bot.onText(/\/invite/, async (msg) => {
  if (String(msg.from.id) !== ADMIN_ID) return;
  const me = await bot.getMe();
  const guide = [
    "\ud83d\udcda \ubc95\ub960 \ub3c4\uc6b0\ubbf8 \ubd07 \uc548\ub0b4",
    "",
    "\ubc95\ub960 \uad00\ub828 \uad81\uae08\ud55c \uc810\uc744 AI\uac00 \uad00\ub828 \ubc95\ub839\uacfc \ud310\ub840\ub97c \uac80\uc0c9\ud574\uc11c \uc26c\uac8c \uc124\uba85\ud574\ub4dc\ub9bd\ub2c8\ub2e4.",
    "",
    "\ud83d\udd17 \uc2dc\uc791 \ubc29\ubc95:",
    `1. \ud154\ub808\uadf8\ub7a8\uc5d0\uc11c @${me.username} \uac80\uc0c9`,
    "2. '\uc2dc\uc791' \ubc84\ud2bc \ud074\ub9ad",
    "3. \uc2b9\uc778 \ud6c4 \ubc14\ub85c \uc9c8\ubb38 \uac00\ub2a5!",
    "",
    "\ud83d\udca1 \uc9c8\ubb38 \uc608\uc2dc:",
    '\u2022 "\uc784\ub300\ucc28 \ubcf4\uc99d\uae08 \ubabb \ubc1b\uc73c\uba74 \uc5b4\ub5bb\uac8c \ud574?"',
    '\u2022 "\uad50\ud1b5\uc0ac\uace0 \ud569\uc758\uae08 \uae30\uc900\uc774 \uc5b4\ub5bb\uac8c \ub3fc?"',
    '\u2022 "\uc0c1\uc18d \ud3ec\uae30 \uc808\ucc28\uac00 \uc5b4\ub5bb\uac8c \ub418\ub098?"',
    "",
    "\u26a0\ufe0f \ubc95\uc801 \uc870\uc5b8\uc774 \uc544\ub2cc \ucc38\uace0 \uc815\ubcf4\ub97c \uc81c\uacf5\ud569\ub2c8\ub2e4.",
  ].join("\n");
  await bot.sendMessage(msg.chat.id, guide);
});

// \u2500\u2500\u2500 \ud038 \uce74\ud14c\uace0\ub9ac \ubc84\ud2bc \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Design Ref: \u00a75.2 \u2014 \ud038 \uce74\ud14c\uace0\ub9ac \ubc84\ud2bc
const CATEGORIES = [
  { text: "\ud83c\udfe0 \ubd80\ub3d9\uc0b0/\uc784\ub300\ucc28", data: "cat_realestate" },
  { text: "\ud83d\udcbc \uadfc\ub85c/\ub178\ub3d9", data: "cat_labor" },
  { text: "\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 \uc0c1\uc18d/\uac00\uc871", data: "cat_family" },
  { text: "\ud83d\ude97 \uad50\ud1b5\uc0ac\uace0", data: "cat_traffic" },
  { text: "\u2696\ufe0f \ud615\uc0ac/\uace0\uc18c", data: "cat_criminal" },
  { text: "\ud83d\udcdd \ubbfc\uc0ac/\uc18c\uc1a1", data: "cat_civil" },
];

const CATEGORY_PROMPTS = {
  cat_realestate: "\ubd80\ub3d9\uc0b0/\uc784\ub300\ucc28 \ubd84\uc57c\uc785\ub2c8\ub2e4. \uc784\ub300\ucc28, \ub9e4\ub9e4, \ub4f1\uae30, \ubcf4\uc99d\uae08 \ub4f1 \ubb34\uc5c7\uc774 \uad81\uae08\ud558\uc138\uc694?",
  cat_labor: "\uadfc\ub85c/\ub178\ub3d9 \ubd84\uc57c\uc785\ub2c8\ub2e4. \uc784\uae08, \ud574\uace0, \uc0b0\uc7ac, \uadfc\ub85c\uacc4\uc57d \ub4f1 \ubb34\uc5c7\uc774 \uad81\uae08\ud558\uc138\uc694?",
  cat_family: "\uc0c1\uc18d/\uac00\uc871 \ubd84\uc57c\uc785\ub2c8\ub2e4. \uc0c1\uc18d, \uc774\ud63c, \uc591\uc721\uad8c, \uc7ac\uc0b0\ubd84\ud560 \ub4f1 \ubb34\uc5c7\uc774 \uad81\uae08\ud558\uc138\uc694?",
  cat_traffic: "\uad50\ud1b5\uc0ac\uace0 \ubd84\uc57c\uc785\ub2c8\ub2e4. \ud569\uc758\uae08, \uacfc\uc2e4\ube44\uc728, \ubcf4\ud5d8, \ucc98\ubc8c \ub4f1 \ubb34\uc5c7\uc774 \uad81\uae08\ud558\uc138\uc694?",
  cat_criminal: "\ud615\uc0ac/\uace0\uc18c \ubd84\uc57c\uc785\ub2c8\ub2e4. \uace0\uc18c, \uace0\ubc1c, \uc218\uc0ac, \uc7ac\ud310 \ub4f1 \ubb34\uc5c7\uc774 \uad81\uae08\ud558\uc138\uc694?",
  cat_civil: "\ubbfc\uc0ac/\uc18c\uc1a1 \ubd84\uc57c\uc785\ub2c8\ub2e4. \uc190\ud574\ubc30\uc0c1, \ucc44\uad8c\ucd94\uc2ec, \uc18c\uc1a1\uc808\ucc28 \ub4f1 \ubb34\uc5c7\uc774 \uad81\uae08\ud558\uc138\uc694?",
};

bot.onText(/\/category/, (msg) => {
  if (!isAuthorized(msg.from.id)) return;
  const keyboard = [];
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const row = [{ text: CATEGORIES[i].text, callback_data: CATEGORIES[i].data }];
    if (CATEGORIES[i + 1]) row.push({ text: CATEGORIES[i + 1].text, callback_data: CATEGORIES[i + 1].data });
    keyboard.push(row);
  }
  safeSend(msg.chat.id, "\ud83d\udcda \ubd84\uc57c\ub97c \uc120\ud0dd\ud574\uc8fc\uc138\uc694:", {
    reply_markup: { inline_keyboard: keyboard },
  });
});

// \u2500\u2500\u2500 \ucf5c\ubc31 \ud578\ub4e4\ub7ec \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
bot.on("callback_query", async (query) => {
  await bot.answerCallbackQuery(query.id);

  const chatId = query.message.chat.id;
  const data = query.data;

  // 사용자 승인/거절 (관리자만)
  if (data.startsWith("approve_") || data.startsWith("deny_")) {
    if (String(query.from.id) !== ADMIN_ID) return;
    const targetId = data.split("_")[1];
    if (data.startsWith("approve_")) {
      // 메모리에 추가
      if (!AUTHORIZED_USERS.includes(targetId)) {
        AUTHORIZED_USERS.push(targetId);
      }
      // .env 파일에 저장
      const envPath = path.join(__dirname, ".env");
      try {
        let envContent = fs.readFileSync(envPath, "utf8");
        const match = envContent.match(/^AUTHORIZED_USERS=(.*)$/m);
        if (match) {
          const current = match[1].split(",").map(s => s.trim()).filter(Boolean);
          if (!current.includes(targetId)) current.push(targetId);
          envContent = envContent.replace(/^AUTHORIZED_USERS=.*$/m, `AUTHORIZED_USERS=${current.join(",")}`);
        } else {
          envContent += `\nAUTHORIZED_USERS=${targetId}\n`;
        }
        fs.writeFileSync(envPath, envContent, "utf8");
      } catch (e) { console.error("[ENV 저장 실패]", e.message); }

      await bot.editMessageText(
        `\u2705 *\uc2b9\uc778 \uc644\ub8cc!*\n\uc720\uc800 ID: \`${targetId}\``,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
      // 승인된 사용자에게 알림
      await bot.sendMessage(targetId,
        "\ud83c\udf89 *\uc2b9\uc778\ub418\uc5c8\uc2b5\ub2c8\ub2e4!*\n\n" +
        "\uc774\uc81c \ubc95\ub960 \ub3c4\uc6b0\ubbf8 \ubd07\uc744 \uc0ac\uc6a9\ud560 \uc218 \uc788\uc5b4\uc694.\n" +
        "\uad81\uae08\ud55c \uac78 \ud3b8\ud558\uac8c \ubb3c\uc5b4\ubcf4\uc138\uc694!\n\n" +
        "/category \u2014 \ubd84\uc57c\ubcc4 \ube60\ub978 \uc9c8\ubb38\n" +
        "/help \u2014 \uc0ac\uc6a9\ubc95 \uc548\ub0b4", { parse_mode: "Markdown" }).catch(() => {});
    } else {
      await bot.editMessageText(
        `\u274c *\uac70\uc808\ub428*\n\uc720\uc800 ID: \`${targetId}\``,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
      await bot.sendMessage(targetId,
        "\uc8c4\uc1a1\ud569\ub2c8\ub2e4. \uc2b9\uc778\uc774 \uac70\uc808\ub418\uc5c8\uc2b5\ub2c8\ub2e4.\n\uad00\ub9ac\uc790\uc5d0\uac8c \ubb38\uc758\ud574\uc8fc\uc138\uc694.").catch(() => {});
    }
    return;
  }

  if (!isAuthorized(query.from.id)) return;

  // \uce74\ud14c\uace0\ub9ac \uc120\ud0dd
  if (data.startsWith("cat_")) {
    const promptText = CATEGORY_PROMPTS[data];
    if (promptText) safeSend(chatId, promptText);
    return;
  }

  // \ud6c4\uc18d \ubc84\ud2bc
  if (data === "followup_detail") {
    await handleQuestion(chatId, query.from.id, "\ubc29\uae08 \ub2f5\ubcc0\uc5d0 \ub300\ud574 \ub354 \uc790\uc138\ud788 \uc124\uba85\ud574\uc8fc\uc138\uc694.");
  } else if (data === "followup_precedent") {
    await handleQuestion(chatId, query.from.id, "\ubc29\uae08 \ub2f5\ubcc0\uacfc \uad00\ub828\ub41c \ud310\ub840\ub97c \ucc3e\uc544\uc8fc\uc138\uc694.");
  } else if (data === "followup_new") {
    sessions.delete(String(query.from.id));
    safeSend(chatId, "\uc0c8 \ub300\ud654\ub97c \uc2dc\uc791\ud569\ub2c8\ub2e4. \uc9c8\ubb38\ud574\uc8fc\uc138\uc694!");
  }
});

// \u2500\u2500\u2500 \ud6c4\uc18d \ubc84\ud2bc \uc0dd\uc131 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Design Ref: \u00a75.3 \u2014 \ud6c4\uc18d \ubc84\ud2bc
function followupKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: "\ud83d\udd0d \ub354 \uc790\uc138\ud788", callback_data: "followup_detail" },
        { text: "\ud83d\udcda \uad00\ub828 \ud310\ub840", callback_data: "followup_precedent" },
        { text: "\ud83c\udd95 \uc0c8 \uc9c8\ubb38", callback_data: "followup_new" },
      ]],
    },
  };
}

// \u2500\u2500\u2500 \uc9c8\ubb38 \ucc98\ub9ac \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function handleQuestion(chatId, userId, text) {
  if (busyUsers.has(String(userId))) {
    await safeSend(chatId, "\uc774\uc804 \uc9c8\ubb38\uc744 \ucc98\ub9ac \uc911\uc785\ub2c8\ub2e4. \uc7a0\uc2dc \uae30\ub2e4\ub824\uc8fc\uc138\uc694.");
    return;
  }

  if (!checkDailyLimit(userId)) {
    await safeSend(chatId,
      `\u26a0\ufe0f \uc624\ub298 \uc9c8\ubb38 \ud55c\ub3c4(${CONFIG.DAILY_QUERY_LIMIT}\ud68c)\ub97c \ucd08\uacfc\ud588\uc2b5\ub2c8\ub2e4.\n\n` +
      `\ub0b4\uc77c \uc790\uc815(\ubc24 12\uc2dc) \uc774\ud6c4 \ub2e4\uc2dc \uc774\uc6a9\ud560 \uc218 \uc788\uc5b4\uc694.`);
    return;
  }

  busyUsers.add(String(userId));
  try {
    const result = await runLawQuery(text, chatId, userId);
    await safeSend(chatId, result, followupKeyboard());
  } catch (err) {
    console.error(`[Error] ${err.message}`);
    // Design Ref: \u00a77 \u2014 \uc5d0\ub7ec \ud578\ub4e4\ub9c1
    if (err.message.includes("\uc2dc\uac04 \ucd08\uacfc") || err.message.includes("timeout")) {
      await safeSend(chatId,
        "\u23f3 \ubc95\uc81c\ucc98 \uc11c\ubc84\uac00 \uc751\ub2f5\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.\n\n" +
        "\uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.\n" +
        "\uacc4\uc18d \uc548 \ub418\uba74 \uad00\ub9ac\uc790\uc5d0\uac8c \uc54c\ub824\uc8fc\uc138\uc694.");
    } else {
      await safeSend(chatId,
        "\u274c \uc751\ub2f5 \uc911 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4.\n\n" +
        "\ub2e4\uc2dc \uc9c8\ubb38\ud574\uc8fc\uc138\uc694.\n" +
        "\uacc4\uc18d \uc624\ub958\uac00 \ub098\uba74 /new \ub85c \uc0c8 \ub300\ud654\ub97c \uc2dc\uc791\ud574\ubcf4\uc138\uc694.");
    }
  } finally {
    busyUsers.delete(String(userId));
  }
}

// \u2500\u2500\u2500 \uba54\uc2dc\uc9c0 \ud578\ub4e4\ub7ec (\uc790\uc5f0\uc5b4 \uc9c8\ubb38) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
bot.on("message", async (msg) => {
  // \uba85\ub839\uc5b4\ub294 \ubb34\uc2dc
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!isAuthorized(msg.from.id)) {
    const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "Unknown";
    await requestApproval(msg.chat.id, msg.from.id, name);
    return;
  }

  // \uadf8\ub8f9 \ucc44\ud305\uc5d0\uc11c\ub294 \ubd07 \uba58\uc158 \ub610\ub294 \ub9ac\ud50c\ub77c\uc774\ub9cc \ucc98\ub9ac
  if (msg.chat.type !== "private") {
    const botInfo = await bot.getMe();
    const isMentioned = msg.text.includes(`@${botInfo.username}`);
    const isReply = msg.reply_to_message?.from?.id === botInfo.id;
    if (!isMentioned && !isReply) return;
    // \uba58\uc158 \uc81c\uac70
    msg.text = msg.text.replace(`@${botInfo.username}`, "").trim();
  }

  await handleQuestion(msg.chat.id, msg.from.id, msg.text);
});

// \u2500\u2500\u2500 \ud504\ub85c\uc138\uc2a4 \uad00\ub9ac \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// ─── 전체 사용자 알림 ─────────────────────────────────────────────
async function notifyAll(text, opts = {}) {
  const targets = AUTHORIZED_USERS.length > 0 ? AUTHORIZED_USERS : [];
  if (targets.length === 0) {
    console.log("[notifyAll] 알림 대상 없음 (AUTHORIZED_USERS 비어있음)");
    return;
  }
  for (const uid of targets) {
    try {
      await bot.sendMessage(uid, text, { parse_mode: "Markdown", ...opts });
      console.log(`[notifyAll] → ${uid} 전송 완료`);
    } catch (e) {
      console.error(`[notifyAll] → ${uid} 전송 실패:`, e.message);
    }
  }
}

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] 종료 중...`);
  // 종료 알림은 launcher StopLawBot()에서 SendLawBotTelegram()으로 전송
  releaseLock();
  bot.stopPolling();
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("[UncaughtException]", err.message);
});

// ─── 시작 ─────────────────────────────────────────────────────────
loadSDK().then(async () => {
  console.log("[Bot] \ubc95\ub960 \ub3c4\uc6b0\ubbf8 \ubd07 \uc2dc\uc791!");
  console.log(`[\uc778\uc99d] \ud5c8\uc6a9 \uc0ac\uc6a9\uc790: ${AUTHORIZED_USERS.length > 0 ? AUTHORIZED_USERS.join(", ") : "\uc804\uccb4 \ud5c8\uc6a9"}`);

  // \ud154\ub808\uadf8\ub7a8 \uba85\ub839\uc5b4 \uba54\ub274 \ub4f1\ub85d
  bot.setMyCommands([
    { command: "start", description: "\ubd07 \uc2dc\uc791 / \uc548\ub0b4" },
    { command: "category", description: "\ubd84\uc57c\ubcc4 \ube60\ub978 \uc9c8\ubb38" },
    { command: "new", description: "\uc0c8 \ub300\ud654 \uc2dc\uc791" },
    { command: "help", description: "\uc0ac\uc6a9\ubc95 \uc548\ub0b4" },
    { command: "invite", description: "\uc0ac\uc6a9\uc790 \ucd08\ub300 \uc548\ub0b4\ubb38 (\uad00\ub9ac\uc790)" },
  ]);

  // \uc2dc\uc791 \uc54c\ub9bc\uc740 launcher\uc5d0\uc11c SendLawBotTelegram()\uc73c\ub85c \uc804\uc1a1
});
