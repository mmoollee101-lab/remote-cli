# Law Bot ⚖️

가족 모두가 쓸 수 있는 한국 법률 도우미 봇.
한국 법령, 판례, 행정규칙을 텔레그램으로 검색해서 쉬운 한국어로 설명합니다.

> 메인 [remote-cli](https://github.com/mmoollee101-lab/remote-cli) (Claude Code 텔레그램 원격 제어) 와 **완전히 독립**된 별도 트레이 앱입니다. 메인 봇을 재시작/재빌드해도 법률 봇은 영향받지 않습니다.

## 🚀 빠른 시작

### 사전 준비
- [Node.js 20+](https://nodejs.org)
- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) (`npm i -g @anthropic-ai/claude-code`)

### 설치
1. zip 다운로드 후 원하는 폴더에 압축 해제
2. `setup.bat` 더블클릭 → Node 의존성 설치 + Law Bot.exe 빌드
3. `dist\Law Bot.exe` 더블클릭 → 시스템 트레이에 ⚖️ 보라색 아이콘 등장

### 설정
1. 트레이 아이콘 우클릭 → **설정**
2. 입력 항목:
   - **Telegram Bot Token**: [@BotFather](https://t.me/BotFather) 에서 새 봇 생성 → 토큰 복사 (메인 rcli 봇과 **별도로** 만드세요)
   - **Law API Key (OC)**: [open.law.go.kr](https://open.law.go.kr) 가입 → 마이페이지 → API 키 발급
   - **관리자 ID**: 본인 텔레그램 유저 ID (봇에 `/start` 보내면 확인됨)
   - **사용자 목록**: 가족 멤버 ID (`,` 로 구분, 자동 승인도 가능)
3. 저장 → 봇 자동 재시작

### 사용법
가족이 봇에 평소 말투로 질문하면 됩니다:
- "전세 보증금 못 받으면 어떻게 해?"
- "교통사고 합의금 기준이 어떻게 돼?"
- "상속 포기 절차가 어떻게 되나?"

빠른 카테고리 선택은 `/category` 명령.

## 🔒 보안 / 범위

법률 봇은 **한국 법률 정보만** 답변합니다. 코딩 요청, 잡담, 번역, 일반 상식 등은 거절합니다 (관리자 포함).

## 🛠 트레이 메뉴

| 항목 | 동작 |
|---|---|
| 시작/중지 | 법률 봇 프로세스 제어 |
| 설정 | 봇 토큰 / API 키 / 사용자 편집 |
| 로그 보기 | `law-bot/law-bot.log` 열기 |
| 자동 시작 | 윈도우 부팅 시 자동 실행 |
| 재시작 | 봇 프로세스 재시작 |
| 종료 | 트레이 앱 + 봇 모두 종료 |

## 🔧 점검 중 메시지

봇이 꺼져있을 때 사용자가 메시지를 보내면 launcher 가 직접 폴링하여 "🔧 점검 중" 회신을 한 번만 보냅니다 (사용자별 1회). 종료할 때마다 모든 사용자에게 broadcast 하지 않습니다.

## 📁 폴더 구조

```
law-bot-v2.2.0/
├── dist/
│   └── Law Bot.exe          ← 실행 파일 (트레이 런처)
├── law-bot/
│   ├── law-bot.js           ← 메인 봇 코드
│   ├── law-tools.js         ← 법제처 API 도구
│   ├── config.js            ← 설정값 (throttle 등)
│   ├── package.json
│   └── node_modules/
├── law-launcher.cs           ← 트레이 런처 C# 소스
├── law-app.ico              ← 트레이/exe 아이콘
├── make-law-icon.ps1        ← 아이콘 재생성 스크립트
├── setup.bat                ← 자동 설정/빌드 스크립트
└── README.md
```

## 🔄 메인 rcli 와 함께 쓰기

같은 PC 에서 [remote-cli](https://github.com/mmoollee101-lab/remote-cli) 메인 봇과 같이 사용 가능합니다. 두 exe 는 완전히 독립된 프로세스 / 트레이 아이콘 / 텔레그램 봇 토큰을 사용하므로 서로 영향이 없습니다.

## 라이선스

MIT
