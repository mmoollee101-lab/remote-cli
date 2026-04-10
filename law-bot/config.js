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
  DEFAULT_EFFORT: "medium",
  COMPACTION_THRESHOLD: 50000,

  // \uc0ac\uc6a9\ub7c9 \uc81c\ud55c
  DAILY_QUERY_LIMIT: 50,
};
