# law-bot Design — Option C: Pragmatic Balance

> Plan 문서 기반 상세 설계 — bot.js + law-tools.js 2파일 구조

## Context Anchor

| 항목 | 내용 |
|------|------|
| WHY | 가족(특히 아버지)이 법적 도움 필요시 쉽게 상담받을 수 있도록 |
| WHO | 비개발자 가족 (텔레그램 사용) |
| RISK | law.go.kr API 불안정, XML 파싱 실패, Claude 응답 지연 |
| SUCCESS | 아버지가 혼자서 질문→답변 가능, 응답 < 15초, 면책 고지 포함 |
| SCOPE | 텔레그램 봇 + 법제처 API 6개 + Claude Agent SDK |

---

## 1. Overview

가족용 법률 도우미 텔레그램 봇. 자연어 질문 → Claude AI가 법제처 API로 법령/판례 검색 → 쉬운 한국어 답변.

### 선택된 아키텍처: Option C — Pragmatic Balance

```
law-bot/                        (remote-cli 하위 디렉토리)
├── law-bot.js                  (메인: 텔레그램 + Claude SDK, ~500줄)
├── law-tools.js                (법제처 API 도구 6개 + XML 파싱 + 캐시, ~350줄)
├── config.js                   (상수/설정)
├── .env                        (API 키)
├── .env.example                (템플릿)
└── package.json
```

## 2. File Structure

### 2.1 law-bot.js (메인 파일, ~500줄)

remote-cli의 bot.js 패턴을 따르되, 법률 상담 전용으로 경량화.

```
law-bot.js
├── 환경 설정 + imports
├── 중복 실행 방지 (acquireLock/releaseLock)
├── 텔레그램 봇 초기화
├── 멀티유저 인증 (AUTHORIZED_USERS 배열)
├── Claude Agent SDK 로딩 (loadSDK → sdkQuery)
├── 법률 전문가 시스템 프롬프트
├── runLawQuery() — Claude에 법률 질문 전달 + tool use
├── 명령어 핸들러 (/start, /help, /category)
├── 메시지 핸들러 (자연어 질문 → runLawQuery)
├── 콜백 핸들러 (퀵 버튼, 후속 질문)
├── 유틸 (safeSend, sendLongMessage)
└── 프로세스 관리 (gracefulShutdown)
```

### 2.2 law-tools.js (법률 도구 모듈, ~350줄)

Claude Agent SDK의 custom tools로 등록할 6개 법률 도구 + 공통 인프라.

```
law-tools.js
├── LRU 캐시 (Map 기반, TTL: 검색 1시간, 본문 24시간)
├── XML → JSON 파싱 유틸 (fast-xml-parser)
├── HTTP 클라이언트 (law.go.kr 공통 요청)
├── Tools 정의 (Claude tool use 스키마)
│   ├── search_law — 법령 검색
│   ├── get_law_text — 법령 본문 조회
│   ├── search_precedents — 판례 검색
│   ├── get_precedent_text — 판례 본문
│   ├── search_admin_rule — 행정규칙 검색
│   └── search_ordinance — 조례 검색
└── module.exports = { tools, executeTool }
```

### 2.3 config.js (상수)

```js
module.exports = {
  // 텔레그램
  MAX_MSG_LENGTH: 4096,
  TYPING_INTERVAL: 4000,

  // law.go.kr
  LAW_BASE_URL: "https://www.law.go.kr/DRF/",
  LAW_DISPLAY_COUNT: 5,        // 검색 결과 표시 개수

  // 캐시 TTL (ms)
  CACHE_SEARCH_TTL: 60 * 60 * 1000,        // 1시간
  CACHE_TEXT_TTL: 24 * 60 * 60 * 1000,      // 24시간
  CACHE_MAX_SIZE: 200,

  // Claude SDK
  DEFAULT_BUDGET: 1,             // $1 (가족용이라 낮게)
  DEFAULT_EFFORT: "medium",
  COMPACTION_THRESHOLD: 50000,

  // 사용량 제한
  DAILY_QUERY_LIMIT: 50,         // 일일 질문 제한
};
```

## 3. Claude Agent SDK 연동

### 3.1 시스템 프롬프트

```
당신은 한국 법률 정보 전문가입니다.

역할:
- 사용자의 법률 질문에 대해 관련 법령과 판례를 검색합니다
- 검색된 법조항을 쉬운 한국어로 설명합니다
- 반드시 관련 조문을 인용합니다

규칙:
- 항상 쉬운 한국어로 답변합니다 (법률 용어는 괄호로 풀이)
- 모든 답변 끝에 면책 고지를 포함합니다:
  "⚠️ 이 정보는 법적 조언이 아닌 참고용 정보입니다. 정확한 법률 상담은 변호사와 상의하세요."
- 테이블은 코드 블록(```)으로 작성합니다 (텔레그램 호환)
- 검색 결과가 없으면 솔직히 알려줍니다
```

### 3.2 Tool Use 방식

remote-cli는 `preset: "claude_code"` 도구를 사용하지만, law-bot은 **커스텀 도구만** 사용:

```js
const options = {
  cwd: process.cwd(),
  systemPrompt: LAW_SYSTEM_PROMPT,
  tools: lawTools.tools,           // law-tools.js에서 export
  maxBudgetUsd: CONFIG.DEFAULT_BUDGET,
  effort: CONFIG.DEFAULT_EFFORT,
  compaction: { enabled: true, contextTokenThreshold: CONFIG.COMPACTION_THRESHOLD },
};
```

### 3.3 세션 관리

- 사용자별 세션 ID 관리 (`Map<userId, sessionId>`)
- 대화 이력 유지 — 같은 사용자의 후속 질문은 `resume: sessionId`
- `/new` 명령으로 새 세션 시작

## 4. law.go.kr API 도구 상세

### 4.1 공통 구조

```
Base URL: https://www.law.go.kr/DRF/
인증: OC=<LAW_OC> 쿼리 파라미터
응답: XML (type=XML) 또는 JSON (type=JSON)
```

### 4.2 도구 스키마

#### search_law (법령 검색)
```json
{
  "name": "search_law",
  "description": "한국 법령을 키워드로 검색합니다. 법령명, 법령ID(MST) 목록을 반환합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "검색 키워드 (예: 주택임대차보호법)" },
      "page": { "type": "integer", "description": "페이지 번호 (기본: 1)", "default": 1 }
    },
    "required": ["query"]
  }
}
```
API: `lawSearch.do?target=law&query={query}&display={count}&page={page}&OC={key}&type=XML`

#### get_law_text (법령 본문)
```json
{
  "name": "get_law_text",
  "description": "법령ID(MST)로 법령 본문 전체를 조회합니다. 조문별 내용을 반환합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "mst": { "type": "string", "description": "법령ID (search_law 결과에서 획득)" }
    },
    "required": ["mst"]
  }
}
```
API: `lawService.do?target=law&MST={mst}&OC={key}&type=XML`

#### search_precedents (판례 검색)
```json
{
  "name": "search_precedents",
  "description": "판례를 키워드로 검색합니다. 사건번호, 판결요지 목록을 반환합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "검색 키워드 (예: 보증금 반환)" },
      "page": { "type": "integer", "description": "페이지 번호 (기본: 1)", "default": 1 }
    },
    "required": ["query"]
  }
}
```
API: `lawSearch.do?target=prec&query={query}&display={count}&page={page}&OC={key}&type=XML`

#### get_precedent_text (판례 본문)
```json
{
  "name": "get_precedent_text",
  "description": "판례ID로 판례 본문을 조회합니다. 판결요지, 판결이유 등을 반환합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "판례 일련번호 (search_precedents 결과에서 획득)" }
    },
    "required": ["id"]
  }
}
```
API: `lawService.do?target=prec&ID={id}&OC={key}&type=XML`

#### search_admin_rule (행정규칙 검색)
```json
{
  "name": "search_admin_rule",
  "description": "행정규칙(훈령, 예규, 고시 등)을 검색합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "검색 키워드" }
    },
    "required": ["query"]
  }
}
```
API: `lawSearch.do?target=admrul&query={query}&display={count}&OC={key}&type=XML`

#### search_ordinance (조례 검색)
```json
{
  "name": "search_ordinance",
  "description": "지방자치단체 조례를 검색합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "검색 키워드 (예: 서울시 주차)" }
    },
    "required": ["query"]
  }
}
```
API: `lawSearch.do?target=ordin&query={query}&display={count}&OC={key}&type=XML`

## 5. 텔레그램 인터페이스

### 5.1 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 봇 소개 + 사용법 안내 |
| `/help` | 질문 예시 + 카테고리 안내 |
| `/category` | 분야별 퀵 버튼 표시 |
| `/new` | 새 대화 시작 (세션 초기화) |

### 5.2 퀵 카테고리 버튼

```
[부동산/임대차] [근로/노동]
[상속/가족]     [교통사고]
[형사/고소]     [민사/소송]
```

선택 시 해당 분야 안내 메시지 + "무엇이 궁금하세요?" 후속 질문.

### 5.3 후속 버튼 (답변 후)

```
[더 자세히] [관련 판례 보기] [새 질문]
```

### 5.4 멀티유저 지원

```js
// .env
AUTHORIZED_USERS=123456789,987654321    // 쉼표 구분 사용자 ID

// 인증 체크
function isAuthorized(userId) {
  return AUTHORIZED_USERS.includes(String(userId));
}
```

- 그룹 채팅: `@봇이름 질문` 멘션 또는 `/ask 질문` 명령
- 개인 채팅: 바로 질문
- 미인증 사용자 → "이 봇은 가족 전용입니다" 메시지

## 6. 캐시 설계

```js
// LRU 캐시 — Map 기반, TTL 지원
class LRUCache {
  constructor(maxSize, defaultTTL) { ... }
  get(key) { /* TTL 체크 + LRU 순서 갱신 */ }
  set(key, value, ttl) { /* maxSize 초과시 가장 오래된 항목 삭제 */ }
}

// 인스턴스
const searchCache = new LRUCache(200, CACHE_SEARCH_TTL);   // 검색: 1시간
const textCache = new LRUCache(100, CACHE_TEXT_TTL);        // 본문: 24시간
```

## 7. 에러 핸들링

| 상황 | 처리 |
|------|------|
| law.go.kr 응답 없음 | "법제처 서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요." |
| XML 파싱 실패 | 로그 기록 + "검색 결과를 처리하는 중 오류가 발생했습니다." |
| Claude SDK 에러 | "AI 응답 중 오류가 발생했습니다. 다시 질문해주세요." |
| 일일 한도 초과 | "오늘 질문 한도({limit}회)를 초과했습니다. 내일 다시 이용해주세요." |
| 미인증 사용자 | "이 봇은 가족 전용입니다." (무응답 처리도 가능) |

## 8. 사용량 제한

```js
// 일일 사용량 (자정 리셋)
const dailyUsage = new Map();  // userId → { count, date }

function checkDailyLimit(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const usage = dailyUsage.get(userId);
  if (!usage || usage.date !== today) {
    dailyUsage.set(userId, { count: 1, date: today });
    return true;
  }
  if (usage.count >= CONFIG.DAILY_QUERY_LIMIT) return false;
  usage.count++;
  return true;
}
```

## 9. 배포

- `pkg` 빌드로 exe 생성 (remote-cli와 동일 방식)
- `.env.example` 제공하여 가족이 API 키만 넣으면 됨
- 시작 스크립트 또는 트레이 런처 (remote-cli 재활용 가능)

## 10. 의존성

```json
{
  "dependencies": {
    "node-telegram-bot-api": "^0.66.0",
    "@anthropic-ai/claude-agent-sdk": "^0.2.92",
    "fast-xml-parser": "^4.3.0",
    "dotenv": "^16.4.0"
  }
}
```

## 11. Implementation Guide

### 11.1 구현 순서

1. 프로젝트 초기화 (package.json, .env, config.js)
2. law-tools.js — 법제처 API 클라이언트 + 도구 스키마
3. law-bot.js — 텔레그램 봇 + Claude SDK 연동
4. UX 개선 (퀵 버튼, 후속 버튼, 긴 답변 분할)
5. 안정화 (에러 핸들링, 사용량 제한)
6. 빌드 + 배포

### 11.2 Module Map

| Module | 파일 | 핵심 내용 | 의존 |
|--------|------|----------|------|
| M1 | config.js, .env, package.json | 프로젝트 기반 | 없음 |
| M2 | law-tools.js | 법제처 API 6개 도구 + 캐시 | M1 |
| M3 | law-bot.js | 텔레그램 + Claude SDK + 인증 | M1, M2 |
| M4 | law-bot.js (UX) | 퀵 버튼, 후속 버튼, 분할 전송 | M3 |
| M5 | law-bot.js (안정화) | 에러 핸들링, 사용량 제한, 빌드 | M3 |

### 11.3 Session Guide

| 세션 | 모듈 | 예상 규모 |
|------|------|----------|
| 세션 1 | M1 + M2 | config + law-tools.js (~350줄) |
| 세션 2 | M3 | law-bot.js 핵심 (~400줄) |
| 세션 3 | M4 + M5 | UX + 안정화 (~150줄) |
