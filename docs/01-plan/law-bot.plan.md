# law-bot Plan — 가족용 법률 도우미 텔레그램 봇

> 법제처 API + Claude AI 기반 한국어 법률 상담 봇

## 배경

가족(특히 아버지)이 법적 도움이 필요할 때 텔레그램 채팅방에서 자연어로 질문하면
관련 법령/판례를 검색하고 쉬운 한국어로 답변하는 봇.

## 목표

- 비개발자(가족)도 쉽게 사용 가능한 법률 상담 챗봇
- 법제처 공개 API(law.go.kr) 39개 API 중 핵심 기능 내재화
- Claude AI로 법률 분석 + 쉬운 설명 생성
- 텔레그램 그룹 채팅방에서 멀티유저 지원

## 사전 준비

| 항목 | 상태 | 비고 |
|------|------|------|
| 텔레그램 봇 토큰 | ⬜ | BotFather에서 생성 |
| 법제처 API 키 (LAW_OC) | ⬜ | https://open.law.go.kr 무료 발급 |
| Claude 구독 (Max/Pro) | ✅ | 기존 구독 활용, Agent SDK 사용 |

## 아키텍처

```
사용자 (텔레그램 그룹)
  ↓ 자연어 질문
Telegram Bot (Node.js)
  ↓ 
Claude AI (system prompt: 법률 전문가)
  ↔ law.go.kr API tools
    - 법령 검색 (search_law)
    - 법령 본문 조회 (get_law_text)
    - 판례 검색 (search_precedents)
    - 판례 본문 (get_precedent_text)
    - 행정규칙 검색 (search_admin_rule)
    - 조례 검색 (search_ordinance)
  ↓
쉬운 한국어 답변 + 관련 조문 인용
```

## Phase 구성

### Phase 1 — 기반 구축
- [ ] 프로젝트 초기화 (새 디렉토리 or 모노레포)
- [ ] 텔레그램 봇 기본 구조 (node-telegram-bot-api)
- [ ] 멀티유저 인증 (AUTHORIZED_USERS 배열, 그룹 채팅 지원)
- [ ] law.go.kr API 클라이언트 (검색 + 본문 조회)
- [ ] XML 응답 파싱 유틸
- [ ] LRU 캐시 (검색 1시간, 본문 24시간)

### Phase 2 — Claude AI 연동
- [ ] Claude Agent SDK 통합 (remote-cli와 동일 방식, 기존 구독 활용)
- [ ] 법률 전문가 시스템 프롬프트 설계
  - 한국 법률 전문가 역할
  - 쉬운 한국어로 설명
  - 관련 조문 인용 필수
  - "법적 조언이 아닌 정보 제공" 면책 고지
- [ ] law.go.kr API를 Claude tools로 등록
  - search_law: 법령명 검색
  - get_law_text: 법령 본문 (조문별)
  - search_precedents: 판례 검색
  - get_precedent_text: 판례 본문
- [ ] 응답 포맷팅 (마크다운, 조문 하이라이트)

### Phase 3 — UX 개선
- [ ] 자주 묻는 분야 퀵 버튼 (부동산, 근로, 상속, 교통사고 등)
- [ ] 대화 이력 유지 (세션별 컨텍스트)
- [ ] 긴 답변 분할 전송
- [ ] "더 자세히" / "관련 판례" 후속 버튼
- [ ] 법률 용어 → 쉬운말 자동 변환 지시
- [ ] /help 명령어 (사용법 안내)

### Phase 4 — 안정화 + 배포
- [ ] 에러 핸들링 (API 장애, 타임아웃)
- [ ] 일일 사용량 제한 (API 비용 관리)
- [ ] 포터블 빌드 (exe)
- [ ] .env 템플릿 + 설치 가이드
- [ ] 가족에게 텔레그램 초대 + 사용법 안내

## 기술 스택

| 구분 | 선택 | 이유 |
|------|------|------|
| 런타임 | Node.js 20+ | 기존 remote-cli와 동일 |
| 텔레그램 | node-telegram-bot-api | 검증됨 |
| AI | Claude Agent SDK | 기존 구독 활용, tool use 지원 |
| 법률 API | law.go.kr DRF | 무료, 공식 |
| 빌드 | pkg | 포터블 exe |

## 핵심 law.go.kr API 엔드포인트

| 도구 | API | 파라미터 |
|------|-----|----------|
| 법령 검색 | `lawSearch.do?target=law` | query, sort, page |
| 법령 본문 | `lawService.do?target=law` | MST(법령ID) |
| 판례 검색 | `lawSearch.do?target=prec` | query, sort |
| 판례 본문 | `lawService.do?target=prec` | ID |
| 행정규칙 | `lawSearch.do?target=admrul` | query |
| 조례 | `lawSearch.do?target=ordin` | query |

Base URL: `https://www.law.go.kr/DRF/`
인증: `OC=<API_KEY>` 쿼리 파라미터

## 성공 기준

1. 아버지가 혼자서 질문하고 답변 받을 수 있음
2. "임대차 보증금 못 받으면 어떻게 해?" 같은 자연어 질문에 관련 법조항 + 쉬운 설명
3. 응답 시간 < 15초
4. 면책 고지 항상 포함 ("법적 조언이 아닌 참고 정보입니다")
