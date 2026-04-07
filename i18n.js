// i18n.js — 다국어 문자열 및 번역 함수
// Design Ref: §1.2 — i18n 분리, STRINGS 중앙 관리

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
    cmd_setbudget: "세션 비용 상한 설정",
    cmd_effort: "Effort 레벨 설정",

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

    // callback: resume session select
    session_resumed_full: "🔄 세션 이어받기 완료!\n\n📅 {{time}}\n{{preview}}\n메시지를 보내면 이전 대화가 이어집니다.",

    // locked
    bot_locked: "🔒 봇이 잠겨있습니다.",
    bot_locked_unlock: "🔒 봇이 잠겨있습니다. /unlock 으로 해제하세요.",

    // /status
    status_title: "📊 현재 상태\n\n세션 ID: `{{session}}`\n작업 디렉토리: `{{dir}}`\n처리 중: {{processing}}\n권한 모드: {{mode}}\n비용 상한: ${{budget}}\nEffort: {{effort}}\nVerbosity: {{verbosity}}",
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
    lock_enter_pin: "🔐 PIN을 입력하세요 (4자리 이상):",
    lock_pin_too_short: "❌ PIN은 4자리 이상이어야 합니다. 다시 입력하세요:",
    lock_done: "🔒 봇이 잠겼습니다. /unlock 으로 해제하세요.",
    unlock_enter_pin: "🔓 PIN을 입력하세요:",
    unlock_already: "이미 잠금 해제 상태입니다.",
    unlock_done: "🔓 잠금이 해제되었습니다.",
    unlock_wrong_pin: "❌ PIN이 일치하지 않습니다. 다시 입력하세요:",

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

    // Phase 1: budget/effort
    budget_invalid: "0보다 큰 금액을 입력하세요. `/setbudget 5`",
    budget_set: "💰 세션 비용 상한: ${{amount}}",
    effort_invalid: "`/effort [low|medium|high|max]` (현재: {{current}})",
    effort_set: "⚡ Effort: {{level}}",

    // Phase 2: voice, file paths, numbered options, tree
    cmd_tree: "디렉토리 구조 표시",
    voice_not_configured: "🎤 음성 지원이 비활성화되어 있습니다.\n`.env`에 `OPENAI_API_KEY`를 추가하세요.",
    voice_transcribing: "🎤 음성을 텍스트로 변환 중...",
    voice_transcribed: "🎤 음성 인식: _{{text}}_",
    voice_error: "❌ 음성 변환 오류: {{error}}",
    files_detected: "📎 파일이 감지되었습니다:",
    select_option: "💬 선택하세요:",
    tree_empty: "디렉토리가 비어있습니다.",

    // Phase 3: file management
    cmd_delete: "파일/폴더 삭제",
    cmd_copy: "파일 복사",
    cmd_rename: "파일 이름 변경",
    cmd_move: "파일 이동",
    cmd_revert: "변경사항 되돌리기",
    cmd_search: "파일명 검색",
    cmd_grep: "파일 내용 검색",
    path_required: "경로를 입력하세요.",
    path_outside: "⚠️ 작업 디렉토리 외부 경로입니다.",
    path_not_found: "❌ 경로를 찾을 수 없습니다: `{{path}}`",
    delete_confirm: "🗑️ {{type}} 삭제하시겠습니까?\n`{{path}}`",
    delete_done: "✅ 삭제 완료: `{{path}}`",
    delete_error: "❌ 삭제 실패: {{error}}",
    btn_confirm_delete: "🗑️ 삭제",
    btn_cancel: "❌ 취소",
    file_word: "파일",
    directory_word: "폴더",
    copy_usage: "`/copy <원본> <대상>`",
    copy_done: "✅ 복사 완료: `{{src}}` → `{{dest}}`",
    copy_error: "❌ 복사 실패: {{error}}",
    rename_usage: "`/rename <현재이름> <새이름>`",
    rename_done: "✅ 이름 변경: `{{old}}` → `{{new}}`",
    rename_error: "❌ 이름 변경 실패: {{error}}",
    move_usage: "`/move <원본> <대상>`",
    move_done: "✅ 이동 완료: `{{src}}` → `{{dest}}`",
    move_error: "❌ 이동 실패: {{error}}",
    revert_no_git: "⚠️ 현재 디렉토리에 Git 저장소가 없습니다.",
    revert_no_changes: "✅ 변경사항이 없습니다.",
    revert_preview: "📋 변경된 파일:\n```\n{{diff}}\n```\n되돌리기 옵션을 선택하세요:",
    btn_revert_all: "🔄 전체 되돌리기",
    btn_revert_code: "📝 코드만 되돌리기",
    revert_done: "✅ 되돌리기 완료.",
    revert_error: "❌ 되돌리기 실패: {{error}}",
    revert_cancelled: "취소됨.",
    search_usage: "`/search <패턴>` — 파일명 검색",
    search_no_results: "검색 결과가 없습니다.",
    grep_usage: "`/grep <패턴>` — 파일 내용 검색",
    grep_no_results: "일치하는 파일이 없습니다.",

    // Phase 4: webhook, cron, teleport, verbose
    cmd_webhook: "Webhook 서버 관리",
    cmd_schedule: "예약 작업 등록",
    cmd_schedules: "예약 작업 목록",
    cmd_unschedule: "예약 작업 삭제",
    cmd_teleport: "세션을 PC 터미널로 이관",
    cmd_verbose: "출력 상세도 설정",
    webhook_started: "🌐 Webhook 서버 시작 (포트 {{port}})\n토큰: `{{token}}`",
    webhook_stopped: "🌐 Webhook 서버 중지됨.",
    webhook_status_on: "🌐 Webhook: 🟢 실행 중 (포트 {{port}})",
    webhook_status_off: "🌐 Webhook: 🔴 중지됨\n`/webhook start` 로 시작",
    schedule_usage: '`/schedule "분 시 일 월 요일" "명령어"`\n예: `/schedule "0 9 * * *" "npm test"`',
    schedule_invalid_cron: "❌ 잘못된 cron 표현식입니다.",
    schedule_max_reached: "❌ 최대 예약 수({{max}})에 도달했습니다.",
    schedule_created: "⏰ 예약 #{{id}} 생성\n`{{expression}}` → `{{command}}`",
    schedule_none: "등록된 예약 작업이 없습니다.",
    schedule_not_found: "❌ 해당 예약을 찾을 수 없습니다.",
    schedule_removed: "✅ 예약 #{{id}} 삭제됨.",
    cron_result: "⏰ Cron #{{id}} 실행 결과\n`{{command}}`\n```\n{{result}}\n```",
    teleport_no_session: "활성 세션이 없습니다.",
    teleport_info: "🚀 세션 텔레포트\n\n세션 ID: `{{sessionId}}`\n작업 디렉토리: `{{dir}}`\n\nPC에서 실행:\n```\n{{command}}\n```",
    verbose_usage: "`/verbose [0|1|2]` (현재: {{current}})\n0=조용, 1=보통, 2=상세",
    verbose_set: "🔊 Verbosity: {{level}} ({{label}})",
    verbose_quiet: "조용",
    verbose_normal: "보통",
    verbose_detailed: "상세",

    // Phase 5: Telegraph
    response_telegraph: "📄 응답이 길어서 Telegraph 페이지로 생성했습니다:\n{{url}}",
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
    cmd_setbudget: "Set session budget cap",
    cmd_effort: "Set effort level",

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
    bot_locked_unlock: "🔒 Bot is locked. Use /unlock to unlock.",

    status_title: "📊 Current Status\n\nSession ID: `{{session}}`\nWorking directory: `{{dir}}`\nProcessing: {{processing}}\nPermission mode: {{mode}}\nBudget cap: ${{budget}}\nEffort: {{effort}}\nVerbosity: {{verbosity}}",
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

    lock_enter_pin: "🔐 Enter a PIN (4+ digits):",
    lock_pin_too_short: "❌ PIN must be at least 4 characters. Try again:",
    lock_done: "🔒 Bot is locked. Use /unlock to unlock.",
    unlock_enter_pin: "🔓 Enter your PIN:",
    unlock_already: "Already unlocked.",
    unlock_done: "🔓 Bot has been unlocked.",
    unlock_wrong_pin: "❌ PIN does not match. Try again:",

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

    // Phase 1: budget/effort
    budget_invalid: "Enter amount > 0. `/setbudget 5`",
    budget_set: "💰 Budget cap: ${{amount}}",
    effort_invalid: "`/effort [low|medium|high|max]` (current: {{current}})",
    effort_set: "⚡ Effort: {{level}}",

    // Phase 2: voice, file paths, numbered options, tree
    cmd_tree: "Show directory tree",
    voice_not_configured: "🎤 Voice support is disabled.\nAdd `OPENAI_API_KEY` to your `.env` file.",
    voice_transcribing: "🎤 Transcribing voice...",
    voice_transcribed: "🎤 Transcribed: _{{text}}_",
    voice_error: "❌ Voice transcription error: {{error}}",
    files_detected: "📎 Files detected:",
    select_option: "💬 Select an option:",
    tree_empty: "Directory is empty.",

    // Phase 3: file management
    cmd_delete: "Delete file/folder",
    cmd_copy: "Copy file",
    cmd_rename: "Rename file",
    cmd_move: "Move file",
    cmd_revert: "Revert changes",
    cmd_search: "Search filenames",
    cmd_grep: "Search file contents",
    path_required: "Please enter a path.",
    path_outside: "⚠️ Path is outside working directory.",
    path_not_found: "❌ Path not found: `{{path}}`",
    delete_confirm: "🗑️ Delete this {{type}}?\n`{{path}}`",
    delete_done: "✅ Deleted: `{{path}}`",
    delete_error: "❌ Delete failed: {{error}}",
    btn_confirm_delete: "🗑️ Delete",
    btn_cancel: "❌ Cancel",
    file_word: "file",
    directory_word: "folder",
    copy_usage: "`/copy <source> <destination>`",
    copy_done: "✅ Copied: `{{src}}` → `{{dest}}`",
    copy_error: "❌ Copy failed: {{error}}",
    rename_usage: "`/rename <current> <new>`",
    rename_done: "✅ Renamed: `{{old}}` → `{{new}}`",
    rename_error: "❌ Rename failed: {{error}}",
    move_usage: "`/move <source> <destination>`",
    move_done: "✅ Moved: `{{src}}` → `{{dest}}`",
    move_error: "❌ Move failed: {{error}}",
    revert_no_git: "⚠️ No Git repository in current directory.",
    revert_no_changes: "✅ No changes to revert.",
    revert_preview: "📋 Changed files:\n```\n{{diff}}\n```\nSelect revert option:",
    btn_revert_all: "🔄 Revert All",
    btn_revert_code: "📝 Code Only",
    revert_done: "✅ Revert completed.",
    revert_error: "❌ Revert failed: {{error}}",
    revert_cancelled: "Cancelled.",
    search_usage: "`/search <pattern>` — Search filenames",
    search_no_results: "No results found.",
    grep_usage: "`/grep <pattern>` — Search file contents",
    grep_no_results: "No matching files.",

    // Phase 4: webhook, cron, teleport, verbose
    cmd_webhook: "Webhook server management",
    cmd_schedule: "Create scheduled task",
    cmd_schedules: "List scheduled tasks",
    cmd_unschedule: "Remove scheduled task",
    cmd_teleport: "Transfer session to PC terminal",
    cmd_verbose: "Set output verbosity",
    webhook_started: "🌐 Webhook server started (port {{port}})\nToken: `{{token}}`",
    webhook_stopped: "🌐 Webhook server stopped.",
    webhook_status_on: "🌐 Webhook: 🟢 Running (port {{port}})",
    webhook_status_off: "🌐 Webhook: 🔴 Stopped\n`/webhook start` to start",
    schedule_usage: '`/schedule "min hr day mon dow" "command"`\ne.g. `/schedule "0 9 * * *" "npm test"`',
    schedule_invalid_cron: "❌ Invalid cron expression.",
    schedule_max_reached: "❌ Maximum scheduled tasks ({{max}}) reached.",
    schedule_created: "⏰ Schedule #{{id}} created\n`{{expression}}` → `{{command}}`",
    schedule_none: "No scheduled tasks.",
    schedule_not_found: "❌ Schedule not found.",
    schedule_removed: "✅ Schedule #{{id}} removed.",
    cron_result: "⏰ Cron #{{id}} result\n`{{command}}`\n```\n{{result}}\n```",
    teleport_no_session: "No active session.",
    teleport_info: "🚀 Session Teleport\n\nSession ID: `{{sessionId}}`\nWorking dir: `{{dir}}`\n\nRun on PC:\n```\n{{command}}\n```",
    verbose_usage: "`/verbose [0|1|2]` (current: {{current}})\n0=quiet, 1=normal, 2=detailed",
    verbose_set: "🔊 Verbosity: {{level}} ({{label}})",
    verbose_quiet: "quiet",
    verbose_normal: "normal",
    verbose_detailed: "detailed",

    // Phase 5: Telegraph
    response_telegraph: "📄 Response too long, created Telegraph page:\n{{url}}",
  },
};

/**
 * Create a translation function bound to a language getter.
 * @param {() => string} getLang - function returning current language code
 * @returns {(key: string, vars?: Record<string, string|number>) => string}
 */
function createT(getLang) {
  return function t(key, vars = {}) {
    const lang = getLang();
    const str = STRINGS[lang]?.[key] || STRINGS.ko[key] || key;
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
  };
}

module.exports = { STRINGS, createT };
