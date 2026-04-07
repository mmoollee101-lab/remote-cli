# v2-upgrade Plan

> Claude Telegram Remote CLI Bot — 차세대 업그레이드 계획
> 경쟁 프로젝트 17개 분석 + SDK 신기능 조사 기반

## Goals

- SDK 0.2.45 → 0.2.92 업그레이드로 최신 기능 활용
- 경쟁 프로젝트 대비 부족한 핵심 기능 보완
- 기존 차별점(트레이 런처, PIN 보안, i18n) 유지 강화
- 사용자 경험 전반 개선 (스트리밍, 음성, 파일 관리)

## Requirements

### Phase 1 — SDK 업그레이드 + 기반 강화 (Critical)

#### 1.1 SDK 버전 업그레이드
- `@anthropic-ai/claude-agent-sdk` 0.2.45 → 0.2.92
- Breaking changes 확인 및 대응
- 기존 canUseTool, systemPrompt 호환성 검증

#### 1.2 세션 비용 제한 (`maxBudgetUsd`)
- 세션 생성 시 비용 상한 설정 (기본값: $5)
- `/setbudget <amount>` 명령 추가
- 상한 도달 시 텔레그램 알림 + 세션 종료
- 현재 비용을 `/status`에 표시

#### 1.3 Context Compaction 활성화
- 긴 대화 시 자동 요약으로 컨텍스트 절약
- `context_token_threshold` 설정 (기본: 100,000)
- 200K 초과 시 2배 과금 방지

#### 1.4 Effort 파라미터 지원
- `/effort [low|medium|high|max]` 명령 추가
- 간단한 작업 → low (토큰 절약)
- 복잡한 코딩 → high/max
- 기본값: medium, bot-state.json에 저장

#### 1.5 PIN 영속화
- 현재: 메모리 저장 → 재시작 시 초기화
- 개선: bot-state.json에 SHA-256 해시로 저장
- 재시작 후에도 잠금 상태 유지

### Phase 2 — UX 핵심 개선 (High Impact)

#### 2.1 스트리밍 응답
- Claude 응답을 실시간으로 텔레그램 메시지 업데이트
- 텔레그램 editMessage API 활용 (1초 간격 throttle)
- 긴 응답도 생성 중 즉시 확인 가능
- 참고: claudegram, linuz90 구현 방식

#### 2.2 음성 메시지 지원
- 텔레그램 음성 메시지 수신 → 텍스트 변환 → Claude 전달
- Whisper API (OpenAI) 또는 로컬 whisper.cpp
- 변환된 텍스트를 사용자에게 확인 표시 후 전송
- 참고: linuz90, Remoat 구현 방식

#### 2.3 파일 경로 자동 변환
- Claude 응답에 포함된 파일 경로 감지
- 경로를 클릭 가능한 다운로드 링크로 변환
- 인라인 버튼: 📄 View | 📥 Download
- 참고: terranc/claude-telegram-bot-bridge

#### 2.4 번호 목록 → 인라인 버튼 자동 변환
- Claude 응답의 번호 목록 패턴 감지 (1. xxx / 2. xxx)
- 자동으로 텔레그램 인라인 키보드 버튼 생성
- 사용자가 버튼 클릭 → 해당 선택을 Claude에 전달
- 참고: terranc/claude-telegram-bot-bridge

#### 2.5 디렉토리 트리 명령
- `/tree [depth]` — 디렉토리 구조 시각화
- 기본 depth: 3, 최대: 5
- `.gitignore` 패턴 제외
- 코드 블록으로 깔끔하게 표시

### Phase 3 — 파일 관리 강화 (Medium)

#### 3.1 파일 조작 명령
- `/delete <path>` — 파일/폴더 삭제 (확인 버튼 필수)
- `/copy <src> <dest>` — 파일 복사
- `/rename <old> <new>` — 이름 변경
- `/move <src> <dest>` — 파일 이동
- 모든 조작에 경로 검증 + 확인 프롬프트

#### 3.2 Revert 시스템
- `/revert` — 되돌리기 메뉴 표시
- Git 기반: 마지막 커밋 이후 변경 취소
- 모드: 전체 / 코드만 / 대화만
- 되돌리기 전 변경 내용 미리보기
- 참고: terranc 구현 방식

#### 3.3 파일 검색
- `/search <pattern>` — 파일명 검색 (glob)
- `/grep <pattern>` — 파일 내용 검색
- 결과를 인라인 버튼으로 표시 (클릭 → 내용 보기)

### Phase 4 — 자동화 + 외부 연동 (Advanced)

#### 4.1 Webhook API 서버
- Express 기반 HTTP 엔드포인트
- `POST /webhook` — 외부 이벤트 수신 → 텔레그램 알림
- GitHub Actions, CI/CD 파이프라인 연동
- 인증: Bearer token
- 참고: RichardAtCT 구현 방식

#### 4.2 예약 작업 (Cron)
- `/schedule "0 9 * * *" "npm test"` — cron 표현식으로 예약
- `/schedules` — 예약 목록 조회
- `/unschedule <id>` — 예약 삭제
- node-cron 라이브러리 활용
- 실행 결과를 텔레그램으로 전송

#### 4.3 세션 텔레포트
- `/teleport` — 현재 텔레그램 세션을 PC 터미널로 이관
- 세션 ID + 작업 디렉토리를 클립보드에 복사
- PC에서 `claude --resume <session-id>` 로 계속
- 참고: claudegram 구현 방식

#### 4.4 Verbosity 제어
- `/verbose [0|1|2]` — 출력 상세도 조절
- 0: 최종 결과만 (도구 실행 로그 숨김)
- 1: 기본 (현재 수준)
- 2: 상세 (모든 도구 호출 + 중간 결과)
- bot-state.json에 저장

### Phase 5 — 코드 품질 (Maintenance)

#### 5.1 상수 추출
- 매직 넘버 제거: 포트(18923), 타임아웃(30s), 메시지 제한(4096) 등
- `config.js` 파일로 분리

#### 5.2 상태 관리 리팩토링
- 15+ 전역 변수 → BotState 클래스로 캡슐화
- sessionId, workingDir, isLocked, permissionMode 등

#### 5.3 터널 정리 보장
- process.exit 시 cloudflared 프로세스 확실히 종료
- SIGINT, SIGTERM, uncaughtException 핸들러에 cleanup 추가

#### 5.4 Telegraph Instant View
- 긴 응답 (4096자 초과)을 Telegraph 페이지로 생성
- 링크를 텔레그램으로 전송
- 코드 블록, 테이블 등 리치 포맷 유지
- 참고: claudegram 구현 방식

## Scope

### In scope
- bot.js 개선 (핵심 봇 코드)
- 새 명령어 추가 (/tree, /effort, /setbudget, /schedule 등)
- SDK 업그레이드 및 신기능 통합
- package.json 의존성 업데이트
- bot-state.json 스키마 확장
- launcher.cs 메뉴 업데이트 (필요 시)

### Out of scope
- 멀티채널 확장 (Discord, Slack 등) — 별도 프로젝트로
- 웹 대시보드 — Phase 5+ 이후
- 시맨틱 메모리 (Supabase) — 별도 프로젝트로
- 모바일 앱 개발
- 멀티유저 지원
- TypeScript 마이그레이션 — 별도 작업으로

## Success Criteria

| 기준 | 목표 |
|------|------|
| SDK 버전 | 0.2.92 이상 |
| 비용 제한 | maxBudgetUsd 작동 확인 |
| 스트리밍 | 응답 생성 중 실시간 메시지 업데이트 |
| 음성 지원 | 음성 메시지 → 텍스트 변환 → Claude 전달 |
| 파일 경로 변환 | 응답 내 경로 자동 감지 + 다운로드 버튼 |
| PIN 영속화 | 재시작 후에도 잠금 상태 유지 |
| 새 명령어 | /tree, /effort, /setbudget 정상 작동 |
| 기존 기능 | 모든 기존 기능 정상 동작 유지 |

## Priority & Effort Estimate

| Phase | 우선순위 | 난이도 | 항목 수 |
|-------|---------|--------|--------|
| Phase 1 | 🔴 Critical | 중 | 5 |
| Phase 2 | 🟠 High | 상 | 5 |
| Phase 3 | 🟡 Medium | 중 | 3 |
| Phase 4 | 🟢 Advanced | 상 | 4 |
| Phase 5 | 🔵 Maintenance | 하 | 4 |

## Dependencies

```
Phase 1 (SDK 기반)
  ↓
Phase 2 (UX 개선) ← Phase 1 완료 필요 (SDK 신기능 활용)
  ↓
Phase 3 (파일 관리) ← 독립적, Phase 2와 병렬 가능
  ↓
Phase 4 (자동화) ← Phase 1 완료 필요
  ↓
Phase 5 (품질) ← 모든 Phase 완료 후 정리
```

## Risk Assessment

| 리스크 | 영향 | 대응 |
|--------|------|------|
| SDK 0.2.92 breaking changes | 높음 | 변경 로그 꼼꼼히 확인, 단계적 업그레이드 |
| 텔레그램 editMessage rate limit | 중간 | throttle 간격 조절 (1~2초) |
| Whisper API 비용 | 낮음 | 로컬 whisper.cpp 대안 준비 |
| 긴 응답 메시지 분할 | 중간 | Telegraph 대안 경로 확보 |
| cloudflared 터널 안정성 | 낮음 | 재연결 로직 + 상태 모니터링 |

## Reference Projects

| 프로젝트 | 참고 기능 | URL |
|----------|----------|-----|
| terranc/claude-telegram-bot-bridge | Revert, 자동 버튼 변환 | github.com/terranc/claude-telegram-bot-bridge |
| RichardAtCT/claude-code-telegram | Webhook, Cron, Verbosity | github.com/RichardAtCT/claude-code-telegram |
| NachoSEO/claudegram | 스트리밍, 텔레포트, Telegraph | github.com/NachoSEO/claudegram |
| linuz90/claude-telegram-bot | 음성, 멀티모달 | github.com/linuz90/claude-telegram-bot |
| godagoo/claude-telegram-relay | 시맨틱 메모리, 프로액티브 | github.com/godagoo/claude-telegram-relay |
| optimistengineer/Remoat | 로컬 Whisper, Forum Topics | github.com/optimistengineer/Remoat |
