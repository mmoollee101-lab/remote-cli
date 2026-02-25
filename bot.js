require("dotenv").config();
delete process.env.CLAUDECODE; // SDK가 중첩 세션 감지하지 않도록
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec } = require("child_process");
const express = require("express");

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

// ─── i18n ────────────────────────────────────────────────────────
let currentLang = "ko"; // loadState()에서 덮어씀

function getLocale() {
  return currentLang === "ko" ? "ko-KR" : "en-US";
}

const STRINGS = {
  ko: {
    // setMyCommands
    cmd_start: "봇 시작 + 유저 ID 안내",
    cmd_new: "새 세션 시작",
    cmd_status: "현재 상태 (세션, 디렉토리)",
    cmd_setdir: "작업 디렉토리 변경",
    cmd_cancel: "현재 작업 취소",
    cmd_files: "파일 목록 보기",
    cmd_read: "파일 내용 읽기",
    cmd_preview: "파일 미리보기 (HTML/이미지/스크립트)",
    cmd_tunnel: "터널 관리 (status/start/stop)",
    cmd_resume: "터미널 세션 이어받기",
    cmd_restart: "봇 재시작",
    cmd_plan: "다음 메시지에 플랜 모드 적용",
    cmd_lock: "PIN으로 봇 잠금",
    cmd_unlock: "잠금 해제",

    // /start
    start_no_auth: "안녕하세요, {{name}}님!\n\n당신의 Telegram 유저 ID: `{{id}}`\n\n.env 파일에 다음을 추가한 뒤 봇을 재시작하세요:\n`AUTHORIZED_USER_ID={{id}}`",
    start_unauthorized: "⛔ 인증되지 않은 사용자입니다.",
    start_welcome: "✅ 인증 완료! Claude Code Remote Controller 준비됨.\n\n세션 ID: `{{session}}`\n작업 디렉토리: `{{dir}}`\n\n명령어 목록:\n/new - 새 세션 시작\n/resume - 터미널 세션 이어받기\n/plan - 다음 메시지에 플랜 모드 적용\n/status - 현재 상태\n/setdir <경로> - 작업 디렉토리 변경\n/cancel - 현재 작업 취소\n/files - 파일 목록\n/read <파일> - 파일 내용 읽기\n/preview <파일> - 파일 미리보기\n/tunnel - 터널 관리\n/lock <PIN> - 봇 잠금\n/unlock <PIN> - 잠금 해제\n\n일반 메시지를 보내면 Claude Code에 전달됩니다.",

    // /new + session handoff
    active_session_detected: "🟢 PC에서 진행 중인 세션이 감지되었습니다.\n💬 {{preview}}\n📅 {{time}}\n\n이어받으시겠습니까?",
    btn_resume_active: "🟢 이어받기",
    btn_new_session: "🆕 새 세션",
    new_session_started: "🆕 새 세션이 시작되었습니다.\n📂 `{{dir}}`\n\n권한 모드를 선택하세요:",
    btn_safe_mode: "🔒 안전 모드 (기본)",
    btn_skip_mode: "⚡ 전체 허용",

    // callback: resume_startup
    session_resumed: "🔄 세션 이어받기 완료!\n📅 {{time}}\n\n권한 모드를 선택하세요:",
    btn_safe_mode_short: "🔒 안전 모드",
    no_session_to_resume: "이어받을 세션이 없습니다.",

    // callback: perm selection
    mode_set: "{{mode}}로 설정되었습니다.",
    mode_safe: "🔒 안전 모드",
    mode_skip: "⚡ 전체 허용 모드",
    ready_prompt: "📂 `{{dir}}`{{resumeHint}}\n\n메시지를 보내면 작업이 시작됩니다. 디렉토리 변경: /setdir",
    resume_hint: "\n이전 세션이 이어집니다.",
    select_perm_mode: "권한 모드를 선택하세요:",

    // callback: tool approval
    plan_approval_title: "📋 **계획 승인 요청**\n\n{{detail}}",
    tool_approval_title: "🔒 도구 승인 요청\n\n{{icon}} **{{name}}**",
    btn_plan_approve: "✅ 승인 — 진행",
    btn_plan_reject: "❌ 수정 필요",
    btn_tool_approve: "✅ 허용",
    btn_tool_reject: "❌ 거부",
    plan_content_header: "📋 **계획 내용:**\n\n{{content}}",
    plan_approve_question: "📋 위 계획을 승인하시겠습니까?",
    plan_rejected_title: "❌ 계획 수정이 필요합니다.",
    plan_rejection_input: "✏️ 수정 사항을 입력해주세요:",
    plan_rejected_msg: "사용자가 계획을 거부했습니다. 수정 요청: {{feedback}}",
    plan_rejected_no_feedback: "사용자가 계획을 거부했습니다. 수정이 필요합니다.",
    tool_approved_msg: "✅ 도구 사용이 허용되었습니다.",
    tool_denied_msg: "❌ 도구 사용이 거부되었습니다.",
    tool_denied_sdk: "사용자가 도구 사용을 거부했습니다.",

    // callback: sdk ask
    ask_text_input: "✏️ 직접 입력",
    ask_enter_text: "✏️ 답변을 텍스트로 입력해주세요:",
    ask_invalid_choice: "잘못된 선택입니다.",

    // callback: quick actions
    quick_cleanup_msg: "🗑 대화를 정리하는 중...",
    quick_cleanup_hint: "텔레그램에서 채팅방 상단 `...` → `Clear History`로 전체 정리할 수 있어요.\n\n봇 세션은 유지됩니다.",
    already_processing: "⏳ 이미 처리 중입니다.",
    btn_cleanup: "🗑 대화 정리",
    btn_commit: "💾 커밋 푸시",
    btn_summary: "📋 요약",

    // callback: preview kill
    process_killed: "🛑 프로세스 종료됨 (PID: {{pid}})",
    process_already_killed: "⚪ 이미 종료된 프로세스입니다.",

    // callback: photo_only
    // (no text needed)

    // callback: resume session select
    session_resumed_full: "🔄 세션 이어받기 완료!\n\n📅 {{time}}\n{{preview}}\n메시지를 보내면 이전 대화가 이어집니다.",

    // locked
    bot_locked: "🔒 봇이 잠겨있습니다.",
    bot_locked_unlock: "🔒 봇이 잠겨있습니다. `/unlock <PIN>`으로 해제하세요.",

    // /status
    status_title: "📊 현재 상태\n\n세션 ID: `{{session}}`\n작업 디렉토리: `{{dir}}`\n처리 중: {{processing}}\n권한 모드: {{mode}}",
    status_processing_yes: "⏳ 예",
    status_processing_no: "✅ 아니오",
    status_mode_skip: "⚡ 전체 허용",
    status_mode_safe: "🔒 안전",

    // /setdir
    setdir_prompt: "📂 현재: `{{dir}}`\n\n어디로 이동할까요?",
    setdir_not_found: "❌ 디렉토리를 찾을 수 없습니다: `{{dir}}`",
    setdir_changed: "📂 작업 디렉토리 변경됨: `{{dir}}`",

    // /cancel
    cancel_done: "🛑 현재 작업이 취소되었습니다.",
    cancel_nothing: "실행 중인 작업이 없습니다.",

    // /restart
    restart_msg: "🔄 봇을 재시작합니다...",

    // /plan
    plan_activated: "📝 플랜 모드 활성화됨.\n다음 메시지에 대해 계획을 먼저 작성합니다.",
    plan_force_prefix: "반드시 EnterPlanMode를 사용해서 플랜을 먼저 작성하고 승인받은 후 진행해줘.\n\n",

    // /lock, /unlock
    lock_pin_required: "🔐 4자리 이상의 PIN을 입력하세요: `/lock 1234`",
    lock_done: "🔒 봇이 잠겼습니다. `/unlock <PIN>`으로 해제하세요.",
    unlock_already: "이미 잠금 해제 상태입니다.",
    unlock_done: "🔓 잠금이 해제되었습니다.",
    unlock_wrong_pin: "❌ PIN이 일치하지 않습니다.",

    // /files
    files_empty: "(빈 디렉토리)",

    // /read
    read_prompt: "📄 읽을 파일명을 입력하세요:",
    read_path_traversal: "⛔ 작업 디렉토리 밖의 파일에는 접근할 수 없습니다.",
    read_not_found: "❌ 파일을 찾을 수 없습니다: `{{file}}`",
    read_is_dir: "❌ `{{file}}`은(는) 디렉토리입니다.",
    read_too_large: "❌ 파일이 너무 큽니다 ({{size}}MB). 1MB 이하 파일만 읽을 수 있습니다.",
    read_error: "❌ 파일 읽기 오류: {{error}}",

    // /preview
    preview_prompt: "👁️ 미리볼 파일명을 입력하세요:",
    preview_not_found: "❌ 파일을 찾을 수 없습니다: `{{file}}`",
    preview_html_link: "🌐 미리보기 링크:\n{{url}}\n\n터널 종료: /tunnel stop",
    preview_exe_running: "▶️ `{{file}}` 실행 중...",
    preview_exe_screenshot: "📸 {{file}} 실행 후 스크린샷",
    preview_script_running: "▶️ `{{file}}` 실행 중...",
    preview_script_result: "💻 `{{file}}` 실행 결과:\n```\n{{output}}\n```",
    preview_output_trimmed: "...(잘림)",
    preview_gui_caption: "📸 {{file}} (GUI)",
    preview_gui_running: "▶️ `{{file}}` 실행 중 (PID: {{pid}})",
    preview_btn_kill: "🛑 프로세스 종료",
    preview_too_large: "❌ 파일이 너무 큽니다 ({{size}}MB). 50MB 이하만 전송 가능합니다.",
    preview_error: "❌ 미리보기 오류: {{error}}",

    // /tunnel
    tunnel_active: "🟢 터널 활성\n🌐 {{url}}\n\n종료: /tunnel stop",
    tunnel_inactive: "⚪ 터널 비활성\n\n시작: /tunnel start",
    tunnel_already_active: "🟢 이미 활성 상태입니다.\n🌐 {{url}}",
    tunnel_starting: "⏳ 터널 시작 중...",
    tunnel_started: "🟢 터널 시작됨!\n🌐 {{url}}\n\n종료: /tunnel stop",
    tunnel_start_failed: "❌ 터널 시작 실패: {{error}}",
    tunnel_already_inactive: "⚪ 터널이 이미 비활성 상태입니다.",
    tunnel_stopped: "🔴 터널이 종료되었습니다.",
    tunnel_usage: "사용법: `/tunnel [status|start|stop]`",

    // /resume
    resume_no_sessions: "이어받을 세션이 없습니다.\n📂 `{{dir}}`",
    resume_select: "🔄 이어받을 세션을 선택하세요:\n📂 `{{dir}}`",

    // runClaude
    empty_response: "(빈 응답)",
    error_unknown: "알 수 없는 오류",
    error_prefix: "❌ 오류: {{error}}",
    progress_update: "⏳ 진행 중 ({{turns}}턴 완료, {{time}} 경과)",
    stats_done: "✅ {{turns}}턴 · ${{cost}} · {{duration}}",
    time_min_sec: "{{min}}분 {{sec}}초",
    time_sec: "{{sec}}초",

    // processMessage errors
    sdk_not_loaded: "SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도하세요.",
    error_sdk_hint: "\n\n💡 Claude Agent SDK가 올바르게 설치되어 있는지 확인하세요.",
    queue_added: "📋 대기열에 추가됨 ({{pos}}번째)",

    // photo/document
    photo_received: "📷 사진 수신 완료. 메시지를 입력하면 사진과 함께 전달됩니다.",
    btn_photo_only: "📷 사진만 보내기",
    photo_save_failed: "❌ 사진 저장 실패: {{error}}",
    doc_save_failed: "❌ 파일 저장 실패: {{error}}",
    photo_prompt_with_text: "이미지를 보내드립니다. 절대경로: {{path}}\n\n{{text}}",
    photo_prompt_no_text: "이미지를 보내드립니다. 절대경로: {{path}}\n\n이 이미지를 확인해주세요.",
    doc_prompt_with_text: "파일을 보내드립니다. 절대경로: {{path}}\n\n{{text}}",
    doc_prompt_no_text: "파일을 보내드립니다. 절대경로: {{path}}\n\n이 파일을 확인해주세요.",

    // message handler
    first_select_perm: "먼저 권한 모드를 선택하세요:",
    user_id_info: "유저 ID: `{{id}}`\n.env에 AUTHORIZED_USER_ID를 설정하세요.",

    // script output
    no_output: "(출력 없음)",

    // startup
    bot_started: "🟢 봇이 켜졌습니다. [{{name}}]\n📂 `{{dir}}`",
    active_session_startup: "\n\n🟢 **PC에서 진행 중인 세션 감지!**\n{{dirTag}}💬 {{preview}}",
    recent_session_startup: "\n\n💡 {{dirTag}}세션 ({{timeAgo}}):\n💬 {{preview}}",
    time_ago_min: "{{n}}분 전",
    time_ago_hour: "{{n}}시간 전",
    time_ago_day: "{{n}}일 전",
    btn_resume_active_session: "🟢 활성 세션 이어받기",
    btn_resume_prev_session: "🔄 이전 세션 이어받기",

    // shutdown
    bot_stopped: "🔴 봇이 꺼졌습니다.",

    // reconnect
    reconnected: "🟢 네트워크 재연결됨. 정상 동작합니다.",

    // auto-commit prompt
    auto_commit_prompt: "변경사항을 확인하고 적절한 커밋 메시지로 커밋하고 푸시해줘",
    auto_summary_prompt: "방금 작업한 내용을 간단히 요약해줘",

    // session none
    session_none: "(아직 없음)",
    session_empty: "(없음)",
    content_empty: "(내용 없음)",
  },

  en: {
    cmd_start: "Start bot + show user ID",
    cmd_new: "Start new session",
    cmd_status: "Current status (session, directory)",
    cmd_setdir: "Change working directory",
    cmd_cancel: "Cancel current task",
    cmd_files: "List files",
    cmd_read: "Read file contents",
    cmd_preview: "Preview file (HTML/image/script)",
    cmd_tunnel: "Tunnel management (status/start/stop)",
    cmd_resume: "Resume terminal session",
    cmd_restart: "Restart bot",
    cmd_plan: "Enable plan mode for next message",
    cmd_lock: "Lock bot with PIN",
    cmd_unlock: "Unlock bot",

    start_no_auth: "Hello, {{name}}!\n\nYour Telegram user ID: `{{id}}`\n\nAdd the following to your .env file and restart the bot:\n`AUTHORIZED_USER_ID={{id}}`",
    start_unauthorized: "⛔ Unauthorized user.",
    start_welcome: "✅ Authenticated! Claude Code Remote Controller ready.\n\nSession ID: `{{session}}`\nWorking directory: `{{dir}}`\n\nCommands:\n/new - New session\n/resume - Resume terminal session\n/plan - Plan mode for next message\n/status - Current status\n/setdir <path> - Change directory\n/cancel - Cancel task\n/files - List files\n/read <file> - Read file\n/preview <file> - Preview file\n/tunnel - Tunnel management\n/lock <PIN> - Lock bot\n/unlock <PIN> - Unlock bot\n\nSend any text to forward it to Claude Code.",

    active_session_detected: "🟢 Active session detected on PC.\n💬 {{preview}}\n📅 {{time}}\n\nWould you like to resume?",
    btn_resume_active: "🟢 Resume",
    btn_new_session: "🆕 New Session",
    new_session_started: "🆕 New session started.\n📂 `{{dir}}`\n\nSelect permission mode:",
    btn_safe_mode: "🔒 Safe Mode (default)",
    btn_skip_mode: "⚡ Allow All",

    session_resumed: "🔄 Session resumed!\n📅 {{time}}\n\nSelect permission mode:",
    btn_safe_mode_short: "🔒 Safe Mode",
    no_session_to_resume: "No session to resume.",

    mode_set: "Set to {{mode}}.",
    mode_safe: "🔒 Safe Mode",
    mode_skip: "⚡ Allow All Mode",
    ready_prompt: "📂 `{{dir}}`{{resumeHint}}\n\nSend a message to start. Change directory: /setdir",
    resume_hint: "\nPrevious session will continue.",
    select_perm_mode: "Select permission mode:",

    plan_approval_title: "📋 **Plan Approval Request**\n\n{{detail}}",
    tool_approval_title: "🔒 Tool Approval Request\n\n{{icon}} **{{name}}**",
    btn_plan_approve: "✅ Approve — Proceed",
    btn_plan_reject: "❌ Needs Revision",
    btn_tool_approve: "✅ Allow",
    btn_tool_reject: "❌ Deny",
    plan_content_header: "📋 **Plan Content:**\n\n{{content}}",
    plan_approve_question: "📋 Would you like to approve this plan?",
    plan_rejected_title: "❌ Plan needs revision.",
    plan_rejection_input: "✏️ Please enter your feedback:",
    plan_rejected_msg: "User rejected the plan. Revision request: {{feedback}}",
    plan_rejected_no_feedback: "User rejected the plan. Revision needed.",
    tool_approved_msg: "✅ Tool use approved.",
    tool_denied_msg: "❌ Tool use denied.",
    tool_denied_sdk: "User denied tool use.",

    ask_text_input: "✏️ Custom Input",
    ask_enter_text: "✏️ Please enter your answer:",
    ask_invalid_choice: "Invalid selection.",

    quick_cleanup_msg: "🗑 Cleaning up chat...",
    quick_cleanup_hint: "You can clear all messages via `...` → `Clear History` at the top of the chat.\n\nBot session is preserved.",
    already_processing: "⏳ Already processing.",
    btn_cleanup: "🗑 Cleanup",
    btn_commit: "💾 Commit & Push",
    btn_summary: "📋 Summary",

    process_killed: "🛑 Process terminated (PID: {{pid}})",
    process_already_killed: "⚪ Process already terminated.",

    session_resumed_full: "🔄 Session resumed!\n\n📅 {{time}}\n{{preview}}\nSend a message to continue the previous conversation.",

    bot_locked: "🔒 Bot is locked.",
    bot_locked_unlock: "🔒 Bot is locked. Use `/unlock <PIN>` to unlock.",

    status_title: "📊 Current Status\n\nSession ID: `{{session}}`\nWorking directory: `{{dir}}`\nProcessing: {{processing}}\nPermission mode: {{mode}}",
    status_processing_yes: "⏳ Yes",
    status_processing_no: "✅ No",
    status_mode_skip: "⚡ Allow All",
    status_mode_safe: "🔒 Safe",

    setdir_prompt: "📂 Current: `{{dir}}`\n\nWhere would you like to go?",
    setdir_not_found: "❌ Directory not found: `{{dir}}`",
    setdir_changed: "📂 Working directory changed: `{{dir}}`",

    cancel_done: "🛑 Current task has been cancelled.",
    cancel_nothing: "No task is running.",

    restart_msg: "🔄 Restarting bot...",

    plan_activated: "📝 Plan mode activated.\nA plan will be created before the next message.",
    plan_force_prefix: "You MUST use EnterPlanMode to create a plan first, get approval, then proceed.\n\n",

    lock_pin_required: "🔐 Please enter a PIN of 4+ digits: `/lock 1234`",
    lock_done: "🔒 Bot is locked. Use `/unlock <PIN>` to unlock.",
    unlock_already: "Already unlocked.",
    unlock_done: "🔓 Bot has been unlocked.",
    unlock_wrong_pin: "❌ PIN does not match.",

    files_empty: "(empty directory)",

    read_prompt: "📄 Enter a file name to read:",
    read_path_traversal: "⛔ Cannot access files outside the working directory.",
    read_not_found: "❌ File not found: `{{file}}`",
    read_is_dir: "❌ `{{file}}` is a directory.",
    read_too_large: "❌ File too large ({{size}}MB). Only files under 1MB can be read.",
    read_error: "❌ File read error: {{error}}",

    preview_prompt: "👁️ Enter a file name to preview:",
    preview_not_found: "❌ File not found: `{{file}}`",
    preview_html_link: "🌐 Preview link:\n{{url}}\n\nStop tunnel: /tunnel stop",
    preview_exe_running: "▶️ Running `{{file}}`...",
    preview_exe_screenshot: "📸 Screenshot after running {{file}}",
    preview_script_running: "▶️ Running `{{file}}`...",
    preview_script_result: "💻 `{{file}}` output:\n```\n{{output}}\n```",
    preview_output_trimmed: "...(trimmed)",
    preview_gui_caption: "📸 {{file}} (GUI)",
    preview_gui_running: "▶️ `{{file}}` running (PID: {{pid}})",
    preview_btn_kill: "🛑 Kill Process",
    preview_too_large: "❌ File too large ({{size}}MB). Max 50MB.",
    preview_error: "❌ Preview error: {{error}}",

    tunnel_active: "🟢 Tunnel active\n🌐 {{url}}\n\nStop: /tunnel stop",
    tunnel_inactive: "⚪ Tunnel inactive\n\nStart: /tunnel start",
    tunnel_already_active: "🟢 Already active.\n🌐 {{url}}",
    tunnel_starting: "⏳ Starting tunnel...",
    tunnel_started: "🟢 Tunnel started!\n🌐 {{url}}\n\nStop: /tunnel stop",
    tunnel_start_failed: "❌ Tunnel start failed: {{error}}",
    tunnel_already_inactive: "⚪ Tunnel is already inactive.",
    tunnel_stopped: "🔴 Tunnel has been stopped.",
    tunnel_usage: "Usage: `/tunnel [status|start|stop]`",

    resume_no_sessions: "No sessions to resume.\n📂 `{{dir}}`",
    resume_select: "🔄 Select a session to resume:\n📂 `{{dir}}`",

    empty_response: "(empty response)",
    error_unknown: "Unknown error",
    error_prefix: "❌ Error: {{error}}",
    progress_update: "⏳ In progress ({{turns}} turns, {{time}} elapsed)",
    stats_done: "✅ {{turns}} turns · ${{cost}} · {{duration}}",
    time_min_sec: "{{min}}m {{sec}}s",
    time_sec: "{{sec}}s",

    sdk_not_loaded: "SDK not loaded yet. Please try again shortly.",
    error_sdk_hint: "\n\n💡 Please check that Claude Agent SDK is properly installed.",
    queue_added: "📋 Added to queue (position {{pos}})",

    photo_received: "📷 Photo received. Send a message to forward it with the photo.",
    btn_photo_only: "📷 Send photo only",
    photo_save_failed: "❌ Photo save failed: {{error}}",
    doc_save_failed: "❌ File save failed: {{error}}",
    photo_prompt_with_text: "Here is an image. Absolute path: {{path}}\n\n{{text}}",
    photo_prompt_no_text: "Here is an image. Absolute path: {{path}}\n\nPlease review this image.",
    doc_prompt_with_text: "Here is a file. Absolute path: {{path}}\n\n{{text}}",
    doc_prompt_no_text: "Here is a file. Absolute path: {{path}}\n\nPlease review this file.",

    first_select_perm: "Please select a permission mode first:",
    user_id_info: "User ID: `{{id}}`\nSet AUTHORIZED_USER_ID in .env.",

    no_output: "(no output)",

    bot_started: "🟢 Bot started. [{{name}}]\n📂 `{{dir}}`",
    active_session_startup: "\n\n🟢 **Active session detected on PC!**\n{{dirTag}}💬 {{preview}}",
    recent_session_startup: "\n\n💡 {{dirTag}}Session ({{timeAgo}}):\n💬 {{preview}}",
    time_ago_min: "{{n}}m ago",
    time_ago_hour: "{{n}}h ago",
    time_ago_day: "{{n}}d ago",
    btn_resume_active_session: "🟢 Resume Active Session",
    btn_resume_prev_session: "🔄 Resume Previous Session",

    bot_stopped: "🔴 Bot has been stopped.",

    reconnected: "🟢 Network reconnected. Operating normally.",

    auto_commit_prompt: "Check changes and commit with an appropriate message, then push",
    auto_summary_prompt: "Briefly summarize what was just done",

    session_none: "(none yet)",
    session_empty: "(none)",
    content_empty: "(no content)",
  },
};

function t(key, vars = {}) {
  const str = STRINGS[currentLang]?.[key] || STRINGS.ko[key] || key;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
}

if (!BOT_TOKEN || BOT_TOKEN === "your_bot_token_here") {
  logError("[ERROR] TELEGRAM_BOT_TOKEN이 설정되지 않았습니다. .env 파일을 확인하세요.");
  process.exit(1);
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
  ]);
}
setCommands();

log("[INFO] 봇이 시작되었습니다. 텔레그램에서 메시지를 보내보세요.");

// 시작 알림은 초기화 완료 후 sendStartupMessage()에서 전송

// ─── 상태 영속화 ─────────────────────────────────────────────────
const STATE_FILE = path.join(process.cwd(), "bot-state.json");

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      if (data.lang && STRINGS[data.lang]) currentLang = data.lang;
      if (data.workingDir && fs.existsSync(data.workingDir)) {
        return data.workingDir;
      }
    }
  } catch {}
  return null;
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ workingDir, lang: currentLang }, null, 2));
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
let lockPin = null;
let pendingPlanRejection = null;

// ─── Preview/Tunnel 상태 ────────────────────────────────────────
const PREVIEW_PORT = 18923;
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

function convertMarkdownTables(text) {
  const lines = text.split("\n");
  const result = [];
  let tableLines = [];
  let inTable = false;
  let inCodeBlock = false;

  for (const line of lines) {
    // 코드블록 내부는 건너뛰기
    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      if (inTable && tableLines.length >= 2) {
        result.push("```");
        result.push(...tableLines);
        result.push("```");
        tableLines = [];
        inTable = false;
      }
      result.push(line);
      continue;
    }
    if (inCodeBlock) { result.push(line); continue; }

    const isTableLine = /^\s*\|/.test(line) && /\|\s*$/.test(line);
    if (isTableLine) {
      if (!inTable) inTable = true;
      tableLines.push(line);
    } else {
      if (inTable && tableLines.length >= 2) {
        result.push("```");
        result.push(...tableLines);
        result.push("```");
      } else if (tableLines.length > 0) {
        result.push(...tableLines);
      }
      tableLines = [];
      inTable = false;
      result.push(line);
    }
  }

  if (inTable && tableLines.length >= 2) {
    result.push("```");
    result.push(...tableLines);
    result.push("```");
  } else if (tableLines.length > 0) {
    result.push(...tableLines);
  }

  return result.join("\n");
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
const KOREAN_STOPWORDS = new Set([
  "에", "에서", "의", "로", "으로", "을", "를", "이", "가", "은", "는", "도",
  "좀", "만", "에서의", "으로의", "이라는", "라는", "라고", "이라고", "있는", "안의",
  "폴더", "디렉토리", "프로젝트", "레포", "repo",
  "작업", "시작", "열어", "열기", "가자", "하자", "해줘", "해", "줘", "이동",
  "이동하자", "이동해", "이동해줘", "변경", "변경해", "변경해줘", "갈래", "할래",
  "보자", "봐", "가줘", "열어줘", "옮겨", "옮겨줘", "바꿔", "바꿔줘",
]);

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

  for (const loc of locationMap) {
    const found = loc.keywords.find((kw) => desc.includes(kw));
    if (found) {
      basePaths = loc.paths;
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
  }

  // 3. 입력에서 토큰 추출 → 불용어 제거 → 실제 폴더명과 대조
  const tokens = desc.split(/\s+/).filter((t) => t.length >= 2 && !KOREAN_STOPWORDS.has(t));
  // 위치 키워드도 토큰에서 제거
  for (const loc of locationMap) {
    for (const kw of loc.keywords) {
      const idx = tokens.indexOf(kw);
      if (idx !== -1) tokens.splice(idx, 1);
      // 붙어있는 경우 (바탕화면에 → 바탕화면 + 에)
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].startsWith(kw)) {
          tokens[i] = tokens[i].slice(kw.length);
          if (tokens[i].length < 2 || KOREAN_STOPWORDS.has(tokens[i])) tokens.splice(i, 1);
        }
      }
    }
  }

  // 토큰 끝에 붙은 한국어 조사 제거 (긴 것부터 시도)
  const SUFFIXES = ["에서의", "으로의", "이라는", "에서", "으로", "라는", "이라고", "라고", "의", "에", "로", "을", "를", "이", "가", "은", "는", "도"];
  for (let i = tokens.length - 1; i >= 0; i--) {
    for (const sfx of SUFFIXES) {
      if (tokens[i].endsWith(sfx) && tokens[i].length > sfx.length) {
        tokens[i] = tokens[i].slice(0, -sfx.length);
        break;
      }
    }
    if (tokens[i].length < 1 || KOREAN_STOPWORDS.has(tokens[i])) tokens.splice(i, 1);
  }

  // 편집 거리 계산 (Levenshtein distance)
  function editDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[a.length][b.length];
  }

  // 정확한 매칭 먼저 시도
  for (const base of basePaths) {
    if (!fs.existsSync(base)) continue;
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toLowerCase();
        for (const token of tokens) {
          if (name === token || name.includes(token)) {
            return path.join(base, entry.name);
          }
        }
      }
    } catch {}
  }

  // 유사도 매칭 (오타 허용 - 편집 거리 기반)
  let bestMatch = null;
  let bestDist = Infinity;
  for (const base of basePaths) {
    if (!fs.existsSync(base)) continue;
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toLowerCase();
        for (const token of tokens) {
          if (token.length < 2) continue;
          const dist = editDistance(name, token);
          // 허용 거리: 길이 3 이하면 1, 그 외에는 2
          const maxDist = token.length <= 3 ? 1 : 2;
          if (dist <= maxDist && dist < bestDist) {
            bestDist = dist;
            bestMatch = path.join(base, entry.name);
          }
        }
      }
    } catch {}
  }

  return bestMatch;
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
        "- Respond in the same language the user uses.",
        "- When creating tables, ALWAYS use monospace code blocks (```...```) instead of markdown table syntax (|---|). Telegram does not render markdown tables properly.",
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
    let statsText = "";
    let newSessionId = null;
    let progressMsgId = null;
    let lastProgressUpdate = 0;
    let sentIntermediateText = false;
    let turnCount = 0;
    let lastPeriodicUpdate = Date.now();
    const PERIODIC_UPDATE_INTERVAL = 120000; // 2분

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
                  const sent = await bot.sendMessage(chatId, `${icon} ${block.name}${detail}`, { parse_mode: "Markdown", disable_notification: true });
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
    exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
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
        resolve({ type: "text", output: output || t("no_output") });
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

// /plan - 다음 메시지에 플랜 모드 적용
bot.onText(/\/plan/, async (msg) => {
  if (!isAuthorized(msg)) return;
  if (isLockedCheck(msg)) return;
  const chatId = msg.chat.id;
  forcePlanMode = true;
  await bot.sendMessage(chatId, t("plan_activated"));
});

// /lock <PIN> - 봇 잠금
bot.onText(/\/lock(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const pin = match[1]?.trim();

  if (!pin || pin.length < 4) {
    await bot.sendMessage(chatId, t("lock_pin_required"), {
      parse_mode: "Markdown",
    });
    return;
  }

  lockPin = pin;
  isLocked = true;
  await bot.sendMessage(chatId, t("lock_done"), {
    parse_mode: "Markdown",
  });
  log("[LOCK] 봇 잠김");
});

// /unlock <PIN> - 잠금 해제
bot.onText(/\/unlock(?:\s+(.+))?/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;

  if (!isLocked) {
    await bot.sendMessage(chatId, t("unlock_already"));
    return;
  }

  const pin = match[1]?.trim();
  if (pin === lockPin) {
    isLocked = false;
    lockPin = null;
    await bot.sendMessage(chatId, t("unlock_done"));
    log("[LOCK] 잠금 해제");
  } else {
    await bot.sendMessage(chatId, t("unlock_wrong_pin"));
  }
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
  if (!filePath.startsWith(workingDir)) {
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

    if (stat.size > 1024 * 1024) {
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
  if (!filePath.startsWith(workingDir)) {
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
      if (stat.size > 50 * 1024 * 1024) {
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
  }, 4000);

  try {
    const result = await runClaude(prompt, chatId);
    const response = result.text || "";

    log(`[USER] ${prompt}`);
    log(`[CLAUDE] ${response.substring(0, 200)}${response.length > 200 ? "..." : ""}`);
    log("─".repeat(50));

    if (response) {
      await sendLongMessage(chatId, response, { parse_mode: "Markdown" });
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
    const https = require("https");
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

    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const https = require("https");
    const fileStream = fs.createWriteStream(savePath);
    https.get(url, (res) => {
      res.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close();
        cleanupUploads(uploadsDir);
        log(`[UPLOAD] 파일 저장: ${savePath}`);
        // Claude 세션에 파일 경로 + 캡션 전달
        const prompt = caption
          ? t("doc_prompt_with_text", { path: savePath, text: caption })
          : t("doc_prompt_no_text", { path: savePath });
        processMessage(chatId, prompt);
      });
    });
  } catch (err) {
    await bot.sendMessage(chatId, t("doc_save_failed", { error: err.message }));
  }
});

// ─── 일반 메시지 처리 ─────────────────────────────────────────────
bot.on("message", async (msg) => {
  // 명령어는 무시 (위의 핸들러에서 처리)
  if (msg.text && msg.text.startsWith("/")) return;
  // 파일/사진은 위의 핸들러에서 처리
  if (msg.photo || msg.document) return;
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

  // 잠금 체크
  if (isLocked) {
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

  // Preview 서버/터널 정리
  stopTunnel();

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
