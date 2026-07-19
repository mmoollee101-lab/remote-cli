// Design Ref: \u00a72.3 \u2014 \uc0c1\uc218/\uc124\uc815\uac12 \ubd84\ub9ac
module.exports = {
  // \ud154\ub808\uadf8\ub7a8
  MAX_MSG_LENGTH: 4096,
  TYPING_INTERVAL: 4000,

  // law.go.kr
  LAW_BASE_URL: "https://www.law.go.kr/DRF/",
  LAW_DISPLAY_COUNT: 5,

  // \uce90\uc2dc TTL (ms)
  CACHE_SEARCH_TTL: 60 * 60 * 1000,
  CACHE_TEXT_TTL: 24 * 60 * 60 * 1000,
  CACHE_MAX_SIZE: 200,

  // Claude SDK
  DEFAULT_BUDGET: 1,
  DEFAULT_EFFORT: "low",              // 속도 우선(법률 Q&A엔 low로 충분). 답변이 얕으면 "medium"
  DEFAULT_MODEL: "claude-sonnet-4-6", // 속도 우선 모델(기본 최상위 모델보다 훨씬 빠름)
  COMPACTION_THRESHOLD: 50000,
  STREAMING_THROTTLE: 1200,           // 스트리밍 편집 간격(ms) — 텔레그램 rate limit 회피

  // \uc0ac\uc6a9\ub7c9 \uc81c\ud55c
  DAILY_QUERY_LIMIT: 50,

  // SDK \ud638\ucd9c \ud0c0\uc784\uc544\uc6c3 (ms) \u2014 \ud589 \ubc29\uc9c0
  SDK_TIMEOUT_MS: 120_000,

  // \ud5ec\uc2a4\uccb4\ud06c (dead-man's switch)
  HEALTHCHECK_INTERVAL: 60_000,   // \ud5ec\uc2a4\uccb4\ud06c/\ud551 \uc8fc\uae30 (1\ubd84)
  HEALTHCHECK_TIMEOUT: 10_000,    // getMe/\ud551 \ud0c0\uc784\uc544\uc6c3 (10\ucd08)
  HEALTHCHECK_FAIL_THRESHOLD: 2,  // \uc5f0\uc18d \uc2e4\ud328 N\ud68c \uc2dc \uc7ac\uc2dc\uc791(82)
};
