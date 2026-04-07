# v2-upgrade Design

> Plan 문서 기반 상세 설계 — 현재 bot.js(2,796줄) 단일 파일 구조를 유지하면서 Phase별 변경사항 설계

## Architecture

### 현재 구조 (AS-IS)

```
bot.js (단일 파일, ~2800줄)
├── 중복 실행 방지 (acquireLock/releaseLock)
├── 파일 로깅 (log/logError/writeLogLine)
├── i18n (STRINGS.ko / STRINGS.en)
├── 상태 관리 (전역 변수 15+개)
├── SDK 로딩 (loadSDK → sdkQuery)
├── 메시지 유틸 (safeSend/sendLongMessage/convertMarkdownTables)
├── 디렉토리 해석 (resolveDirectory)
├── 세션 관리 (findRecentSessions/findActiveSessions)
├── 도구 권한 (handleToolPermission/canUseTool)
├── SDK 실행 (runClaude → for await message loop)
├── Preview/Tunnel (Express + cloudflared)
├── 명령어 핸들러 (/start, /new, /status, /setdir, /cancel 등)
├── callback_query 핸들러 (버튼 응답)
├── 파일 업로드 (photo, document)
└── 프로세스 관리 (gracefulShutdown, reconnect)
```

### 목표 구조 (TO-BE)

```
bot.js (확장, ~3500줄 예상)
├── config.js (NEW) ─── 상수/설정값 분리
├── 기존 구조 유지
├── [Phase 1] SDK 옵션 확장 (maxBudgetUsd, compaction, effort)
├── [Phase 1] PIN 영속화 (loadState/saveState 확장)
├── [Phase 2] 스트리밍 응답 (runClaude 내부 수정)
├── [Phase 2] 음성 메시지 핸들러 (bot.on("voice"))
├── [Phase 2] 응답 후처리 (파일경로 감지, 번호→버튼)
├── [Phase 2] /tree 명령어
├── [Phase 3] 파일 조작 명령어 (/delete, /copy, /rename, /move)
├── [Phase 3] Revert 시스템 (/revert)
├── [Phase 3] 검색 명령어 (/search, /grep)
├── [Phase 4] Webhook API 서버 (Express 재활용)
├── [Phase 4] Cron 스케줄러 (/schedule)
├── [Phase 4] /teleport, /verbose
└── [Phase 5] 상수 추출 완료, 터널 정리 강화
```

### 설계 원칙
1. **bot.js 단일 파일 유지** — config.js만 분리, 나머지는 bot.js 내 섹션으로
2. **기존 패턴 준수** — bot.onText, callback_query, safeSend 패턴 그대로
3. **전역 상태 확장** — 새 변수는 기존 상태 관리 섹션에 추가
4. **i18n 필수** — 모든 새 문자열은 STRINGS.ko/en 양쪽에 추가
5. **하위 호환** — 기존 bot-state.json 로드 시 새 필드 없어도 정상 작동

---

## Components

### Phase 1 — SDK 업그레이드 + 기반 강화

#### 1.1 config.js (신규 파일)

```js
// config.js — 상수 및 기본값
module.exports = {
  // 서버
  PREVIEW_PORT: 18923,
  WEBHOOK_PORT: 18924,

  // 제한
  MAX_MSG_LENGTH: 4096,
  MAX_FILE_READ: 1024 * 1024,        // 1MB
  MAX_FILE_SEND: 50 * 1024 * 1024,   // 50MB
  MAX_UPLOAD_FILES: 10,
  LOG_MAX_SIZE: 1024 * 1024,         // 1MB

  // 타이밍
  TYPING_INTERVAL: 4000,
  PROGRESS_THROTTLE: 1500,
  PERIODIC_UPDATE_INTERVAL: 120000,   // 2분
  STREAMING_THROTTLE: 1200,           // 스트리밍 업데이트 간격
  RECONNECT_BASE_DELAY: 5000,
  RECONNECT_MAX_DELAY: 300000,

  // SDK
  DEFAULT_BUDGET_USD: 5.0,
  DEFAULT_EFFORT: "medium",
  COMPACTION_THRESHOLD: 100000,       // 토큰

  // 보안
  PIN_MIN_LENGTH: 4,

  // 스크립트 실행
  SCRIPT_TIMEOUT: 30000,
  SCRIPT_GUI_DETECT_MS: 3000,
  SCRIPT_MAX_OUTPUT: 1024 * 1024,

  // 트리
  TREE_DEFAULT_DEPTH: 3,
  TREE_MAX_DEPTH: 5,

  // Cron
  CRON_MAX_JOBS: 20,

  // Verbosity
  VERBOSITY_QUIET: 0,
  VERBOSITY_NORMAL: 1,
  VERBOSITY_DETAILED: 2,
};
```

#### 1.2 SDK 옵션 확장 — runClaude() 수정

**현재** (bot.js:1223-1243):
```js
const options = {
  cwd: workingDir,
  systemPrompt: { ... },
  tools: { type: "preset", preset: "claude_code" },
  abortController,
  canUseTool: handleToolPermission,
};
if (sessionId) options.resume = sessionId;
```

**변경**:
```js
const options = {
  cwd: workingDir,
  systemPrompt: { ... },
  tools: { type: "preset", preset: "claude_code" },
  abortController,
  canUseTool: handleToolPermission,
  // Phase 1 추가
  maxBudgetUsd: currentBudget,
  effort: currentEffort,
  compaction: {
    enabled: true,
    contextTokenThreshold: CONFIG.COMPACTION_THRESHOLD,
  },
};
```

#### 1.3 새 전역 상태 변수

```js
// Phase 1 — 기존 상태 관리 섹션(line 572~)에 추가
let currentBudget = CONFIG.DEFAULT_BUDGET_USD;  // /setbudget으로 변경
let currentEffort = CONFIG.DEFAULT_EFFORT;       // /effort로 변경
let currentVerbosity = CONFIG.VERBOSITY_NORMAL;  // /verbose로 변경
let cronJobs = new Map();                        // id → { expression, command, job }
let webhookServer = null;                        // Phase 4 webhook Express
let webhookToken = null;                         // Phase 4 인증 토큰
```

#### 1.4 bot-state.json 스키마 확장

**현재**:
```json
{ "workingDir": "...", "lang": "ko" }
```

**변경**:
```json
{
  "workingDir": "...",
  "lang": "ko",
  "pinHash": null,
  "isLocked": false,
  "budget": 5.0,
  "effort": "medium",
  "verbosity": 1,
  "webhookToken": null,
  "cronJobs": []
}
```

**loadState() 수정** — 새 필드에 기본값 적용 (하위 호환):
```js
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      if (data.lang && STRINGS[data.lang]) currentLang = data.lang;
      // Phase 1: 새 필드 로드 (없으면 기본값 유지)
      if (data.budget != null) currentBudget = data.budget;
      if (data.effort) currentEffort = data.effort;
      if (data.verbosity != null) currentVerbosity = data.verbosity;
      if (data.pinHash) { lockPin = null; pinHash = data.pinHash; isLocked = data.isLocked || false; }
      if (data.webhookToken) webhookToken = data.webhookToken;
      if (data.cronJobs) restoreCronJobs(data.cronJobs);
      if (data.workingDir && fs.existsSync(data.workingDir)) return data.workingDir;
    }
  } catch {}
  return null;
}
```

**saveState() 수정**:
```js
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
```

#### 1.5 PIN 영속화 — SHA-256 해시

**변경 범위**: `/lock`, `/unlock`, `loadState`, `saveState`

```js
const crypto = require("crypto");
let pinHash = null; // SHA-256 해시 (lockPin 대체)

function hashPin(pin) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}
```

**/lock 수정** (bot.js:1967~):
```js
// AS-IS: lockPin = inlinePin;
// TO-BE:
pinHash = hashPin(inlinePin);
isLocked = true;
saveState(); // 영속화
```

**/unlock 수정** (bot.js:1990~):
```js
// AS-IS: if (inlinePin === lockPin)
// TO-BE:
if (hashPin(inlinePin) === pinHash) {
  isLocked = false;
  pinHash = null;
  saveState(); // 영속화
}
```

#### 1.6 새 명령어: /setbudget, /effort

```js
// /setbudget <amount> — 세션 비용 상한
bot.onText(/\/setbudget(?:\s+(.+))?/, async (msg, match) => {
  const amount = parseFloat(match[1]);
  if (isNaN(amount) || amount <= 0) {
    return safeSend(chatId, t("budget_invalid")); // "0보다 큰 금액을 입력하세요."
  }
  currentBudget = amount;
  saveState();
  safeSend(chatId, t("budget_set", { amount: amount.toFixed(2) }));
});

// /effort [low|medium|high|max]
bot.onText(/\/effort(?:\s+(.+))?/, async (msg, match) => {
  const level = (match[1] || "").toLowerCase();
  const valid = ["low", "medium", "high", "max"];
  if (!valid.includes(level)) {
    return safeSend(chatId, t("effort_invalid", { current: currentEffort }));
  }
  currentEffort = level;
  saveState();
  safeSend(chatId, t("effort_set", { level }));
});
```

#### 1.7 /status 확장

**현재** (bot.js:1864~):
```
세션 ID / 작업 디렉토리 / 처리 중 / 권한 모드
```

**추가 표시**:
```
비용 상한: $5.00
Effort: medium
Verbosity: 1 (보통)
```

---

### Phase 2 — UX 핵심 개선

#### 2.1 스트리밍 응답 — runClaude() 수정

**핵심 변경**: assistant 메시지의 text 블록을 받을 때마다 메시지를 업데이트

**현재 흐름** (bot.js:1289-1298):
```
text 블록 → sendLongMessage() (새 메시지)
```

**변경 흐름**:
```
text 블록 → 스트리밍 버퍼에 누적 → 1.2초 throttle로 editMessage
최종 완료 → 완성된 텍스트 확인
```

```js
// runClaude() 내부 — 스트리밍 상태
let streamingMsgId = null;
let streamingBuffer = "";
let lastStreamUpdate = 0;

// text 블록 수신 시
if (block.type === "text" && block.text?.trim()) {
  if (progressMsgId) {
    try { await bot.deleteMessage(chatId, progressMsgId); } catch {}
    progressMsgId = null;
  }

  streamingBuffer += block.text;
  const now = Date.now();

  if (now - lastStreamUpdate >= CONFIG.STREAMING_THROTTLE) {
    const displayText = streamingBuffer.length > MAX_MSG_LENGTH
      ? streamingBuffer.slice(-MAX_MSG_LENGTH + 20) // 마지막 부분 표시
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
      // editMessage 실패 (마크다운 오류 등) → 새 메시지로 전환
      if (err.message?.includes("can't parse entities")) {
        try {
          const sent = await bot.sendMessage(chatId, displayText);
          streamingMsgId = sent.message_id;
        } catch {}
      }
    }
    lastStreamUpdate = now;
  }
  sentIntermediateText = true;
}

// result 수신 시 — 최종 메시지 정리
if (message.type === "result") {
  // 스트리밍 중이던 메시지 최종 업데이트
  if (streamingMsgId && streamingBuffer) {
    try {
      await bot.editMessageText(streamingBuffer, {
        chat_id: chatId, message_id: streamingMsgId,
        parse_mode: "Markdown",
      });
    } catch {
      // 마크다운 실패 시 일반 텍스트로 재전송
      try {
        await bot.editMessageText(streamingBuffer, {
          chat_id: chatId, message_id: streamingMsgId,
        });
      } catch {}
    }
  }
  // ... 기존 result 처리 ...
}
```

**Rate Limit 대응**:
- `editMessage`는 동일 메시지에 초당 ~1회 제한
- `STREAMING_THROTTLE: 1200ms`로 안전 마진 확보
- 429 에러 시 3초 대기 후 재시도 (1회)

#### 2.2 음성 메시지 — bot.on("voice")

**의존성 추가**: `openai` (Whisper API용) 또는 로컬 `whisper.cpp`

**설계 결정**: OpenAI Whisper API 사용 (간편, 정확도 높음)
- 비용: $0.006/분 (매우 저렴)
- .env에 `OPENAI_API_KEY` 추가 (선택, 없으면 음성 기능 비활성화)

```js
// 새 의존성
const OpenAI = require("openai"); // package.json에 추가

let openaiClient = null;
if (process.env.OPENAI_API_KEY) {
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

bot.on("voice", async (msg) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  if (!openaiClient) {
    return safeSend(msg.chat.id, t("voice_not_configured"));
  }

  const chatId = msg.chat.id;
  await bot.sendChatAction(chatId, "typing");

  try {
    // 1. 음성 파일 다운로드
    const file = await bot.getFile(msg.voice.file_id);
    const voicePath = path.join(ensureUploadsDir(), `voice_${Date.now()}.ogg`);
    await downloadTelegramFile(file, voicePath);

    // 2. Whisper API로 변환
    const transcription = await openaiClient.audio.transcriptions.create({
      file: fs.createReadStream(voicePath),
      model: "whisper-1",
      language: currentLang === "ko" ? "ko" : "en",
    });

    const text = transcription.text;
    fs.unlinkSync(voicePath); // 임시 파일 삭제

    // 3. 변환 결과 표시 + Claude에 전달
    await safeSend(chatId, t("voice_transcribed", { text }), {
      parse_mode: "Markdown",
      disable_notification: true,
    });

    processMessage(chatId, text);
  } catch (err) {
    await safeSend(chatId, t("voice_error", { error: err.message }));
  }
});
```

#### 2.3 파일 경로 자동 변환 — 응답 후처리

**위치**: `processMessage()` 내 `sendLongMessage()` 호출 전

```js
// 파일 경로 감지 정규식
const FILE_PATH_REGEX = /(?:^|\s)((?:[A-Z]:\\|\/)[^\s"'<>|*?]+\.[a-zA-Z0-9]+)/gm;

function extractFilePaths(text) {
  const paths = [];
  let match;
  while ((match = FILE_PATH_REGEX.exec(text)) !== null) {
    const p = match[1].trim();
    // workingDir 내부 파일만 + 실제 존재하는 파일만
    try {
      const resolved = path.resolve(p);
      if (resolved.startsWith(workingDir) && fs.existsSync(resolved)) {
        paths.push(resolved);
      }
    } catch {}
  }
  return [...new Set(paths)]; // 중복 제거
}

function buildFileButtons(filePaths) {
  // 최대 5개까지만 버튼 생성
  return filePaths.slice(0, 5).map(fp => {
    const name = path.basename(fp);
    return [
      { text: `📄 ${name}`, callback_data: `fview_${Buffer.from(fp).toString("base64").slice(0, 50)}` },
      { text: `📥 Download`, callback_data: `fdown_${Buffer.from(fp).toString("base64").slice(0, 50)}` },
    ];
  });
}
```

**processMessage() 수정**:
```js
if (response) {
  await sendLongMessage(chatId, response, { parse_mode: "Markdown" });

  // 파일 경로 감지 → 다운로드 버튼
  const filePaths = extractFilePaths(response);
  if (filePaths.length > 0) {
    await bot.sendMessage(chatId, t("files_detected"), {
      reply_markup: { inline_keyboard: buildFileButtons(filePaths) },
    });
  }
}
```

**callback_query에 `fview_`/`fdown_` 핸들러 추가**:
```js
// fview_ → /read와 동일 로직
// fdown_ → bot.sendDocument()
```

#### 2.4 번호 목록 → 인라인 버튼

**위치**: `processMessage()` 응답 후처리

```js
const NUMBERED_LIST_REGEX = /^(\d+)\.\s+(.+)$/gm;

function extractNumberedOptions(text) {
  const options = [];
  let match;
  while ((match = NUMBERED_LIST_REGEX.exec(text)) !== null) {
    if (options.length < 8) { // 최대 8개
      options.push({ num: match[1], label: match[2].trim().substring(0, 40) });
    }
  }
  // 연속 번호 (1,2,3...)이고 3개 이상일 때만 버튼화
  if (options.length < 3) return [];
  const isSequential = options.every((o, i) => parseInt(o.num) === i + 1);
  return isSequential ? options : [];
}

function buildOptionButtons(options) {
  // 2열 배치
  const rows = [];
  for (let i = 0; i < options.length; i += 2) {
    const row = [{ text: `${options[i].num}. ${options[i].label}`, callback_data: `numopt_${options[i].num}` }];
    if (options[i + 1]) {
      row.push({ text: `${options[i + 1].num}. ${options[i + 1].label}`, callback_data: `numopt_${options[i + 1].num}` });
    }
    rows.push(row);
  }
  return rows;
}
```

**processMessage() 수정** — 파일 경로 감지 뒤에 추가:
```js
const options = extractNumberedOptions(response);
if (options.length > 0) {
  await bot.sendMessage(chatId, t("select_option"), {
    reply_markup: { inline_keyboard: buildOptionButtons(options) },
  });
}
```

**callback_query에 `numopt_` 핸들러 추가**:
```js
if (data.startsWith("numopt_")) {
  const num = data.replace("numopt_", "");
  // 선택 결과를 Claude에 prompt로 전달
  processMessage(chatId, num);
}
```

#### 2.5 /tree 명령어

```js
bot.onText(/\/tree(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  const maxDepth = Math.min(parseInt(match[1]) || CONFIG.TREE_DEFAULT_DEPTH, CONFIG.TREE_MAX_DEPTH);

  // .gitignore 패턴 로드
  const ignorePatterns = loadGitignore(workingDir);

  function buildTree(dir, prefix, depth) {
    if (depth > maxDepth) return "";
    let result = "";
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith(".") && !ignorePatterns.includes(e.name))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      entries.forEach((entry, i) => {
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = isLast ? "    " : "│   ";
        result += `${prefix}${connector}${entry.name}\n`;
        if (entry.isDirectory()) {
          result += buildTree(path.join(dir, entry.name), prefix + childPrefix, depth + 1);
        }
      });
    } catch {}
    return result;
  }

  const dirName = path.basename(workingDir);
  let tree = `${dirName}/\n` + buildTree(workingDir, "", 1);

  // 너무 길면 자르기
  if (tree.length > 3800) {
    tree = tree.substring(0, 3800) + "\n... (truncated)";
  }

  await safeSend(chatId, `\`\`\`\n${tree}\n\`\`\``, { parse_mode: "Markdown" });
});

function loadGitignore(dir) {
  try {
    const gitignorePath = path.join(dir, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      return fs.readFileSync(gitignorePath, "utf-8")
        .split("\n")
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"));
    }
  } catch {}
  return ["node_modules", "dist", ".git", "__pycache__", ".next"];
}
```

---

### Phase 3 — 파일 관리 강화

#### 3.1 파일 조작 명령어

**공통 패턴**: 경로 검증 → 확인 버튼 → 실행

```js
// /delete <path>
bot.onText(/\/delete(?:\s+(.+))?/, async (msg, match) => {
  const target = resolveFilePath(match[1], workingDir);
  if (!target) return safeSend(chatId, t("path_required"));
  if (!isInsideWorkingDir(target)) return safeSend(chatId, t("path_outside"));

  const stat = fs.statSync(target);
  const typeStr = stat.isDirectory() ? t("directory") : t("file");
  await bot.sendMessage(chatId, t("delete_confirm", { type: typeStr, path: target }), {
    reply_markup: {
      inline_keyboard: [[
        { text: t("btn_confirm_delete"), callback_data: `del_confirm_${encodeBase64Short(target)}` },
        { text: t("btn_cancel"), callback_data: "del_cancel" },
      ]],
    },
  });
});

// /copy <src> <dest>
bot.onText(/\/copy(?:\s+(.+))?/, async (msg, match) => {
  const args = (match[1] || "").split(/\s+/);
  if (args.length < 2) return safeSend(chatId, t("copy_usage"));
  const src = resolveFilePath(args[0], workingDir);
  const dest = resolveFilePath(args[1], workingDir);
  // 검증 후 fs.cpSync(src, dest, { recursive: true })
});

// /rename <old> <new>, /move <src> <dest> — 동일 패턴
```

**헬퍼 함수**:
```js
function resolveFilePath(input, baseDir) {
  if (!input) return null;
  const p = path.resolve(baseDir, input.trim());
  return fs.existsSync(p) ? p : null;
}

function isInsideWorkingDir(filePath) {
  return path.resolve(filePath).startsWith(path.resolve(workingDir));
}

function encodeBase64Short(str) {
  return Buffer.from(str).toString("base64").slice(0, 50);
}
```

#### 3.2 Revert 시스템

**접근**: Git 기반 (workingDir에 git repo가 있을 때만 작동)

```js
bot.onText(/\/revert/, async (msg) => {
  const chatId = msg.chat.id;

  // git 상태 확인
  const isGit = fs.existsSync(path.join(workingDir, ".git"));
  if (!isGit) return safeSend(chatId, t("revert_no_git"));

  // 변경된 파일 목록 표시
  exec("git diff --stat HEAD", { cwd: workingDir }, async (err, stdout) => {
    if (!stdout.trim()) return safeSend(chatId, t("revert_no_changes"));

    await bot.sendMessage(chatId, t("revert_preview", { diff: stdout.trim() }), {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: t("btn_revert_all"), callback_data: "revert_all" }],
          [{ text: t("btn_revert_code"), callback_data: "revert_code" }],
          [{ text: t("btn_cancel"), callback_data: "revert_cancel" }],
        ],
      },
    });
  });
});

// callback: revert_all → exec("git checkout -- .")
// callback: revert_code → exec("git checkout -- '*.js' '*.ts' '*.py' ...")
```

#### 3.3 파일 검색

```js
// /search <pattern> — 파일명 검색
bot.onText(/\/search(?:\s+(.+))?/, async (msg, match) => {
  const pattern = match[1];
  if (!pattern) return safeSend(chatId, t("search_usage"));

  // 재귀 검색 (최대 50개)
  const results = [];
  function searchDir(dir, depth) {
    if (depth > 5 || results.length >= 50) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        if (e.name.toLowerCase().includes(pattern.toLowerCase())) {
          results.push(path.relative(workingDir, path.join(dir, e.name)));
        }
        if (e.isDirectory()) searchDir(path.join(dir, e.name), depth + 1);
      }
    } catch {}
  }
  searchDir(workingDir, 0);

  if (results.length === 0) return safeSend(chatId, t("search_no_results"));

  const list = results.map((r, i) => `${i + 1}. ${r}`).join("\n");
  await safeSend(chatId, `\`\`\`\n${list}\n\`\`\``, { parse_mode: "Markdown" });
});

// /grep <pattern> — 파일 내용 검색
bot.onText(/\/grep(?:\s+(.+))?/, async (msg, match) => {
  const pattern = match[1];
  if (!pattern) return safeSend(chatId, t("grep_usage"));

  // exec("grep -rn --include='*.{js,ts,py,json}' ...")
  exec(
    `grep -rn --include="*.js" --include="*.ts" --include="*.py" --include="*.json" --include="*.md" -l "${pattern.replace(/"/g, '\\"')}" .`,
    { cwd: workingDir, timeout: 10000 },
    async (err, stdout) => {
      const files = stdout.trim().split("\n").filter(Boolean).slice(0, 20);
      if (files.length === 0) return safeSend(chatId, t("grep_no_results"));

      const list = files.map((f, i) => `${i + 1}. ${f}`).join("\n");
      await safeSend(chatId, `\`\`\`\n${list}\n\`\`\``, { parse_mode: "Markdown" });
    }
  );
});
```

---

### Phase 4 — 자동화 + 외부 연동

#### 4.1 Webhook API 서버

**기존 Express 서버와 별도 포트** (PREVIEW_PORT와 분리)

```js
function startWebhookServer() {
  if (webhookServer) return;

  // 토큰 자동 생성 (최초 1회)
  if (!webhookToken) {
    webhookToken = crypto.randomBytes(16).toString("hex");
    saveState();
    log(`[WEBHOOK] 토큰 생성됨: ${webhookToken}`);
  }

  const app = express();
  app.use(express.json());

  // 인증 미들웨어
  app.use((req, res, next) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token !== webhookToken) return res.status(401).json({ error: "Unauthorized" });
    next();
  });

  // POST /webhook — 외부 이벤트 수신
  app.post("/webhook", async (req, res) => {
    const { title, body, level } = req.body;
    // level: info, warning, error
    const icon = { info: "ℹ️", warning: "⚠️", error: "🔴" }[level] || "📬";
    const message = `${icon} **Webhook**\n\n**${title || "Event"}**\n${body || ""}`;

    try {
      await safeSend(AUTHORIZED_USER_ID, message, { parse_mode: "Markdown" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /webhook/run — 원격 Claude 실행 (주의: 인증 필수)
  app.post("/webhook/run", async (req, res) => {
    const { prompt, dir } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    // 비동기 실행, 결과는 텔레그램으로 전송
    const prevDir = workingDir;
    if (dir) workingDir = dir;
    processMessage(AUTHORIZED_USER_ID, prompt);
    workingDir = prevDir;
    res.json({ ok: true, queued: true });
  });

  webhookServer = app.listen(CONFIG.WEBHOOK_PORT, () => {
    log(`[WEBHOOK] 서버 시작 — port ${CONFIG.WEBHOOK_PORT}`);
  });
}
```

**Telegram 명령어**:
```js
// /webhook [status|start|stop|token]
bot.onText(/\/webhook(?:\s+(.+))?/, async (msg, match) => {
  const sub = (match[1] || "status").trim();
  if (sub === "start") { startWebhookServer(); return safeSend(chatId, t("webhook_started")); }
  if (sub === "stop") { webhookServer?.close(); webhookServer = null; return safeSend(chatId, t("webhook_stopped")); }
  if (sub === "token") { return safeSend(chatId, `Token: \`${webhookToken}\``); }
  // status
  safeSend(chatId, t("webhook_status", { running: !!webhookServer, port: CONFIG.WEBHOOK_PORT }));
});
```

#### 4.2 Cron 스케줄러

**의존성 추가**: `node-cron`

```js
const cron = require("node-cron");
let cronCounter = 0;

bot.onText(/\/schedule(?:\s+"([^"]+)"\s+"([^"]+)")?/, async (msg, match) => {
  if (!match[1] || !match[2]) return safeSend(chatId, t("schedule_usage"));

  const expression = match[1];
  const command = match[2];

  if (!cron.validate(expression)) return safeSend(chatId, t("schedule_invalid_cron"));
  if (cronJobs.size >= CONFIG.CRON_MAX_JOBS) return safeSend(chatId, t("schedule_max_reached"));

  const id = ++cronCounter;
  const job = cron.schedule(expression, async () => {
    log(`[CRON] 실행: ${command}`);
    exec(command, { cwd: workingDir, timeout: 60000 }, async (err, stdout, stderr) => {
      const result = err ? `❌ ${err.message}` : (stdout || "(no output)");
      await safeSend(AUTHORIZED_USER_ID, t("cron_result", { id, command, result: result.substring(0, 1000) }));
    });
  });

  cronJobs.set(String(id), { expression, command, job });
  saveState();
  safeSend(chatId, t("schedule_created", { id, expression, command }));
});

// /schedules — 목록 조회
bot.onText(/\/schedules/, async (msg) => {
  if (cronJobs.size === 0) return safeSend(chatId, t("schedule_none"));
  const list = [...cronJobs.entries()]
    .map(([id, j]) => `#${id}: \`${j.expression}\` → \`${j.command}\``)
    .join("\n");
  safeSend(chatId, list, { parse_mode: "Markdown" });
});

// /unschedule <id>
bot.onText(/\/unschedule(?:\s+(\d+))?/, async (msg, match) => {
  const id = match[1];
  const entry = cronJobs.get(id);
  if (!entry) return safeSend(chatId, t("schedule_not_found"));
  entry.job.stop();
  cronJobs.delete(id);
  saveState();
  safeSend(chatId, t("schedule_removed", { id }));
});
```

**영속화 헬퍼**:
```js
function serializeCronJobs() {
  return [...cronJobs.entries()].map(([id, j]) => ({
    id, expression: j.expression, command: j.command,
  }));
}

function restoreCronJobs(arr) {
  for (const item of arr) {
    const job = cron.schedule(item.expression, async () => { /* ... */ });
    cronJobs.set(item.id, { ...item, job });
    cronCounter = Math.max(cronCounter, parseInt(item.id));
  }
}
```

#### 4.3 /teleport

```js
bot.onText(/\/teleport/, async (msg) => {
  if (!sessionId) return safeSend(chatId, t("teleport_no_session"));

  const command = `claude --resume ${sessionId}`;

  // 클립보드에 복사 (Windows)
  exec(`echo ${command}| clip`, { cwd: workingDir });

  await safeSend(chatId, t("teleport_info", {
    sessionId,
    dir: workingDir,
    command,
  }), { parse_mode: "Markdown" });
});
```

#### 4.4 /verbose

```js
bot.onText(/\/verbose(?:\s+(\d+))?/, async (msg, match) => {
  const level = parseInt(match[1]);
  if (isNaN(level) || level < 0 || level > 2) {
    return safeSend(chatId, t("verbose_usage", { current: currentVerbosity }));
  }
  currentVerbosity = level;
  saveState();
  const labels = [t("verbose_quiet"), t("verbose_normal"), t("verbose_detailed")];
  safeSend(chatId, t("verbose_set", { level, label: labels[level] }));
});
```

**runClaude() 수정** — verbosity에 따른 표시 제어:
```js
// tool_use 블록 표시 조건
if (block.type === "tool_use") {
  if (currentVerbosity === 0) continue; // quiet: 도구 진행 표시 안함

  if (currentVerbosity === 2) {
    // detailed: 도구 입출력까지 표시
    // tool_result도 표시
  }
  // verbosity 1 (기본): 현재와 동일
}
```

---

### Phase 5 — 코드 품질

#### 5.1 상수 추출

bot.js 상단에서:
```js
const CONFIG = require("./config");
```

기존 하드코딩 값들을 `CONFIG.XXX`로 교체:
- `4096` → `CONFIG.MAX_MSG_LENGTH`
- `18923` → `CONFIG.PREVIEW_PORT`
- `1500` → `CONFIG.PROGRESS_THROTTLE`
- `120000` → `CONFIG.PERIODIC_UPDATE_INTERVAL`
- `30000` → `CONFIG.SCRIPT_TIMEOUT`
- 등

#### 5.2 터널 정리 강화

**현재** (gracefulShutdown):
```js
stopTunnel();
stopPreviewServer();
```

**추가**:
```js
process.on("uncaughtException", (err) => {
  logError(`[FATAL] ${err.message}`);
  stopTunnel();
  stopPreviewServer();
  webhookServer?.close();
  releaseLock();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logError(`[FATAL] Unhandled rejection: ${reason}`);
});
```

#### 5.3 Telegraph Instant View (선택)

**의존성**: 없음 (Telegraph API는 인증 불필요)

```js
async function createTelegraphPage(title, content) {
  const https = require("https");
  // Telegraph API: https://telegra.ph/api
  // createPage 호출 → URL 반환
  // HTML content를 Node[] 형식으로 변환
}
```

4096자 초과 응답 시 `sendLongMessage()` 내부에서:
```js
if (text.length > MAX_MSG_LENGTH * 2) {
  // 매우 긴 응답 → Telegraph 페이지 생성
  const url = await createTelegraphPage("Claude Response", text);
  if (url) return safeSend(chatId, t("response_telegraph", { url }));
}
// 기본: 기존 분할 전송
```

---

## Data Model

### bot-state.json (최종 스키마)

```json
{
  "workingDir": "C:\\Users\\...\\project",
  "lang": "ko",
  "pinHash": "sha256hex...",
  "isLocked": false,
  "budget": 5.0,
  "effort": "medium",
  "verbosity": 1,
  "webhookToken": "hex32...",
  "cronJobs": [
    { "id": "1", "expression": "0 9 * * *", "command": "npm test" }
  ]
}
```

### 새 의존성 (package.json)

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.92",
    "cloudflared": "^0.7.1",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "node-telegram-bot-api": "^0.66.0",
    "openai": "^4.80.0",
    "node-cron": "^3.0.3"
  }
}
```

### 새 환경변수 (.env)

```env
# 기존
TELEGRAM_BOT_TOKEN=...
AUTHORIZED_USER_ID=...
COMPUTER_NAME=...

# Phase 2 (선택)
OPENAI_API_KEY=...          # 음성 메시지용 Whisper API
```

---

## Implementation Order

### Phase 1 — SDK 업그레이드 + 기반 강화
```
1.  config.js 생성 + bot.js에서 import
2.  package.json SDK 버전 업데이트 → npm install
3.  runClaude() 옵션에 maxBudgetUsd, effort, compaction 추가
4.  /setbudget, /effort 명령어 추가
5.  PIN 영속화 (crypto.createHash, loadState/saveState 수정)
6.  /status 표시 확장
7.  STRINGS.ko/en에 새 문자열 추가
8.  테스트: 기존 기능 정상 작동 확인
```

### Phase 2 — UX 핵심 개선
```
9.  스트리밍 응답 (runClaude 내부 수정)
10. 음성 메시지 핸들러 (openai 의존성 + bot.on("voice"))
11. 파일 경로 감지 + 다운로드 버튼
12. 번호 목록 → 인라인 버튼
13. /tree 명령어
14. STRINGS.ko/en에 새 문자열 추가
15. 테스트: 스트리밍 + 음성 + 버튼
```

### Phase 3 — 파일 관리 강화
```
16. /delete, /copy, /rename, /move 명령어
17. /revert 시스템 (git 기반)
18. /search, /grep 명령어
19. callback_query 핸들러 확장
20. STRINGS.ko/en에 새 문자열 추가
```

### Phase 4 — 자동화 + 외부 연동
```
21. Webhook API 서버 (node-cron 의존성 + Express)
22. /schedule, /schedules, /unschedule 명령어
23. /teleport 명령어
24. /verbose 명령어 + runClaude verbosity 제어
25. STRINGS.ko/en에 새 문자열 추가
26. setCommands() 업데이트
```

### Phase 5 — 코드 품질
```
27. 매직 넘버 → CONFIG.XXX 교체
28. 터널/웹훅 서버 cleanup 강화
29. Telegraph Instant View (선택)
30. README.md 업데이트
```

---

## i18n 추가 문자열 목록

### Phase 1
| Key | KO | EN |
|-----|----|----|
| `budget_invalid` | 0보다 큰 금액을 입력하세요. `/setbudget 5` | Enter amount > 0. `/setbudget 5` |
| `budget_set` | 💰 세션 비용 상한: ${{amount}} | 💰 Budget cap: ${{amount}} |
| `effort_invalid` | `/effort [low\|medium\|high\|max]` (현재: {{current}}) | `/effort [low\|medium\|high\|max]` (current: {{current}}) |
| `effort_set` | ⚡ Effort: {{level}} | ⚡ Effort: {{level}} |
| `budget_exceeded` | 💰 비용 상한 도달 (${{amount}}). 세션이 종료되었습니다. | 💰 Budget cap reached (${{amount}}). Session ended. |

### Phase 2
| Key | KO | EN |
|-----|----|----|
| `voice_not_configured` | 🎤 음성 기능이 설정되지 않았습니다. .env에 OPENAI_API_KEY를 추가하세요. | 🎤 Voice not configured. Add OPENAI_API_KEY to .env. |
| `voice_transcribed` | 🎤 `{{text}}` | 🎤 `{{text}}` |
| `voice_error` | 🎤 음성 변환 오류: {{error}} | 🎤 Voice error: {{error}} |
| `files_detected` | 📎 감지된 파일: | 📎 Files detected: |
| `select_option` | 👆 선택하세요: | 👆 Select an option: |

### Phase 3
| Key | KO | EN |
|-----|----|----|
| `delete_confirm` | ⚠️ {{type}} 삭제: `{{path}}`\n정말 삭제하시겠습니까? | ⚠️ Delete {{type}}: `{{path}}`\nAre you sure? |
| `revert_no_git` | Git 저장소가 아닙니다. | Not a git repository. |
| `revert_preview` | 📋 변경된 파일:\n```\n{{diff}}\n``` | 📋 Changed files:\n```\n{{diff}}\n``` |
| `search_no_results` | 🔍 결과 없음 | 🔍 No results |

### Phase 4
| Key | KO | EN |
|-----|----|----|
| `webhook_started` | 🌐 Webhook 서버 시작 (포트: {{port}}) | 🌐 Webhook started (port: {{port}}) |
| `schedule_created` | ⏰ #{{id}} 예약 완료: `{{expression}}` → `{{command}}` | ⏰ #{{id}} Scheduled: `{{expression}}` → `{{command}}` |
| `teleport_info` | 🚀 PC 터미널에서 실행:\n`{{command}}`\n\n(클립보드에 복사됨) | 🚀 Run in terminal:\n`{{command}}`\n\n(Copied to clipboard) |

---

## Callback Data 규칙

| Prefix | Phase | 용도 |
|--------|-------|------|
| `fview_` | 2 | 파일 보기 (base64 경로) |
| `fdown_` | 2 | 파일 다운로드 (base64 경로) |
| `numopt_` | 2 | 번호 선택 (번호) |
| `del_confirm_` | 3 | 삭제 확인 (base64 경로) |
| `del_cancel` | 3 | 삭제 취소 |
| `revert_all` | 3 | 전체 되돌리기 |
| `revert_code` | 3 | 코드만 되돌리기 |
| `revert_cancel` | 3 | 되돌리기 취소 |

---

## setCommands() 확장

```js
const commands = [
  // 기존
  { command: "start", description: t("cmd_start") },
  { command: "new", description: t("cmd_new") },
  { command: "resume", description: t("cmd_resume") },
  { command: "plan", description: t("cmd_plan") },
  { command: "status", description: t("cmd_status") },
  { command: "setdir", description: t("cmd_setdir") },
  { command: "cancel", description: t("cmd_cancel") },
  { command: "files", description: t("cmd_files") },
  { command: "read", description: t("cmd_read") },
  { command: "preview", description: t("cmd_preview") },
  { command: "tunnel", description: t("cmd_tunnel") },
  { command: "lock", description: t("cmd_lock") },
  { command: "unlock", description: t("cmd_unlock") },
  { command: "restart", description: t("cmd_restart") },
  // Phase 1
  { command: "setbudget", description: t("cmd_setbudget") },
  { command: "effort", description: t("cmd_effort") },
  // Phase 2
  { command: "tree", description: t("cmd_tree") },
  // Phase 3
  { command: "delete", description: t("cmd_delete") },
  { command: "search", description: t("cmd_search") },
  { command: "grep", description: t("cmd_grep") },
  { command: "revert", description: t("cmd_revert") },
  // Phase 4
  { command: "schedule", description: t("cmd_schedule") },
  { command: "teleport", description: t("cmd_teleport") },
  { command: "verbose", description: t("cmd_verbose") },
  { command: "webhook", description: t("cmd_webhook") },
];
```

**주의**: 텔레그램은 명령어 최대 100개, 설명 최대 256자 제한.
