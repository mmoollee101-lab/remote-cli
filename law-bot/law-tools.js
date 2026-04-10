// Design Ref: §2.2 — 법제처 API 도구 모듈 (Option C: Pragmatic)
// SDK 연동: createSdkMcpServer + tool() 패턴 사용
const https = require("https");
const { XMLParser } = require("fast-xml-parser");
const CONFIG = require("./config");

const LAW_OC = process.env.LAW_OC;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

// ─── LRU 캐시 ─────────────────────────────────────────────────────
class LRUCache {
  constructor(maxSize, defaultTTL) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.cache = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, ttl) {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expires: Date.now() + (ttl || this.defaultTTL) });
  }
}

const searchCache = new LRUCache(CONFIG.CACHE_MAX_SIZE, CONFIG.CACHE_SEARCH_TTL);
const textCache = new LRUCache(100, CONFIG.CACHE_TEXT_TTL);

// ─── HTTP 클라이언트 ───────────────────────────────────────────────
function fetchLaw(endpoint, params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ ...params, OC: LAW_OC, type: "XML" });
    const url = `${CONFIG.LAW_BASE_URL}${endpoint}?${query}`;

    https.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = parser.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`XML 파싱 실패: ${e.message}`));
        }
      });
    }).on("error", reject)
      .on("timeout", () => reject(new Error("법제처 서버 응답 시간 초과")));
  });
}

// ─── 도구 실행 함수들 ──────────────────────────────────────────────

async function searchLaw(input) {
  const cacheKey = `law:${input.query}:${input.page || 1}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const result = await fetchLaw("lawSearch.do", {
    target: "law", query: input.query,
    display: CONFIG.LAW_DISPLAY_COUNT, page: input.page || 1,
  });

  const items = result?.LawSearch?.law;
  if (!items) return `"${input.query}" 검색 결과가 없습니다. 법제처 API는 법령 이름으로 검색합니다. 예: "육아휴직" 대신 "남녀고용평등", "임대차" 대신 "주택임대차보호법" 등 법령명 키워드로 다시 검색해보세요.`;

  const laws = Array.isArray(items) ? items : [items];
  const formatted = laws.map((l, i) =>
    `${i + 1}. ${l["법령명한글"] || l["법령명"] || l.lawNameKo || "(법령명 없음)"}\n` +
    `   법령ID(MST): ${l["법령일련번호"] || l.MST || "N/A"}\n` +
    `   시행일: ${l["시행일자"] || l.enforcementDate || "N/A"}`
  ).join("\n\n");

  const output = `법령 검색 결과 (${laws.length}건):\n\n${formatted}`;
  searchCache.set(cacheKey, output);
  return output;
}

async function getLawText(input) {
  const cacheKey = `lawtext:${input.mst}`;
  const cached = textCache.get(cacheKey);
  if (cached) return cached;

  const result = await fetchLaw("lawService.do", {
    target: "law", MST: input.mst,
  });

  const law = result?.["법령"] || result?.Law;
  if (!law) return "법령 본문을 찾을 수 없습니다.";

  const lawName = law["기본정보"]?.["법령명_한글"] || law["법령명"] || law.lawNameKo || "";
  const articlesRoot = law["조문"] || law.Article;
  if (!articlesRoot) {
    const output = `법령명: ${lawName}\n\n조문 정보를 파싱할 수 없습니다.`;
    textCache.set(cacheKey, output);
    return output;
  }

  // 조문단위 배열 추출 (XML 구조: 법령 > 조문 > 조문단위[])
  const units = articlesRoot["조문단위"] || articlesRoot;
  const artList = Array.isArray(units) ? units : [units];
  const formatted = artList.slice(0, 30).map((a) => {
    const num = a["조문번호"] || a["@_번호"] || a.articleNo || "";
    const title = a["조문제목"] || a.articleTitle || "";
    const content = a["조문내용"] || a.articleContent || "";
    return `제${num}조 ${title}\n${content}`;
  }).join("\n\n");

  const output = `법령명: ${lawName}\n(총 ${artList.length}조 중 처음 30조)\n\n${formatted}`;
  textCache.set(cacheKey, output);
  return output;
}

async function searchPrecedents(input) {
  const cacheKey = `prec:${input.query}:${input.page || 1}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const result = await fetchLaw("lawSearch.do", {
    target: "prec", query: input.query,
    display: CONFIG.LAW_DISPLAY_COUNT, page: input.page || 1,
  });

  const items = result?.PrecSearch?.prec;
  if (!items) return "판례 검색 결과가 없습니다.";

  const precs = Array.isArray(items) ? items : [items];
  const formatted = precs.map((p, i) =>
    `${i + 1}. ${p["사건명"] || p.caseNm || "(사건명 없음)"}\n` +
    `   사건번호: ${p["사건번호"] || p.caseNo || "N/A"}\n` +
    `   판례ID: ${p["판례일련번호"] || p.precSeq || "N/A"}\n` +
    `   선고일: ${p["선고일자"] || p.judgmentDate || "N/A"}`
  ).join("\n\n");

  const output = `판례 검색 결과 (${precs.length}건):\n\n${formatted}`;
  searchCache.set(cacheKey, output);
  return output;
}

async function getPrecedentText(input) {
  const cacheKey = `prectext:${input.id}`;
  const cached = textCache.get(cacheKey);
  if (cached) return cached;

  const result = await fetchLaw("lawService.do", {
    target: "prec", ID: input.id,
  });

  const prec = result?.["판례"] || result?.Precedent;
  if (!prec) return "판례 본문을 찾을 수 없습니다.";

  const caseName = prec["사건명"] || prec.caseNm || "";
  const caseNo = prec["사건번호"] || prec.caseNo || "";
  const courtName = prec["법원명"] || prec.courtNm || "";
  const judgDate = prec["선고일자"] || prec.judgmentDate || "";
  const summary = prec["판례내용"] || prec["판시사항"] || prec.judgmentAbstract || "";
  const reason = prec["판결요지"] || prec.judgmentSummary || "";

  const output = [
    `사건명: ${caseName}`,
    `사건번호: ${caseNo}`,
    `법원: ${courtName}`,
    `선고일: ${judgDate}`,
    "",
    reason ? `[판결요지]\n${reason}` : "",
    summary ? `[판례내용]\n${summary.substring(0, 3000)}` : "",
  ].filter(Boolean).join("\n");

  textCache.set(cacheKey, output);
  return output;
}

async function searchAdminRule(input) {
  const cacheKey = `admrul:${input.query}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const result = await fetchLaw("lawSearch.do", {
    target: "admrul", query: input.query,
    display: CONFIG.LAW_DISPLAY_COUNT,
  });

  const items = result?.AdmRulSearch?.admrul;
  if (!items) return "행정규칙 검색 결과가 없습니다.";

  const rules = Array.isArray(items) ? items : [items];
  const formatted = rules.map((r, i) =>
    `${i + 1}. ${r["행정규칙명"] || r.admRulNm || "(명칭 없음)"}\n` +
    `   시행일: ${r["시행일자"] || "N/A"}`
  ).join("\n\n");

  const output = `행정규칙 검색 결과 (${rules.length}건):\n\n${formatted}`;
  searchCache.set(cacheKey, output);
  return output;
}

async function searchOrdinance(input) {
  const cacheKey = `ordin:${input.query}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const result = await fetchLaw("lawSearch.do", {
    target: "ordin", query: input.query,
    display: CONFIG.LAW_DISPLAY_COUNT,
  });

  const items = result?.OrdinSearch?.ordin;
  if (!items) return "조례 검색 결과가 없습니다.";

  const ordins = Array.isArray(items) ? items : [items];
  const formatted = ordins.map((o, i) =>
    `${i + 1}. ${o["조례명"] || o.ordinNm || "(명칭 없음)"}\n` +
    `   지자체: ${o["지자체명"] || "N/A"}`
  ).join("\n\n");

  const output = `조례 검색 결과 (${ordins.length}건):\n\n${formatted}`;
  searchCache.set(cacheKey, output);
  return output;
}

// ─── SDK MCP 도구 생성 ─────────────────────────────────────────────
// createSdkMcpServer + tool() 패턴으로 Claude Agent SDK에 등록
function createLawMcpServer(sdk) {
  const { createSdkMcpServer, tool } = sdk;
  const z = require("zod");

  return createSdkMcpServer({
    name: "law-tools",
    version: "1.0.0",
    tools: [
      tool("search_law", "한국 법령을 키워드로 검색합니다. 법령명, 법령ID(MST) 목록을 반환합니다.", {
        query: z.string().describe("검색 키워드 (예: 주택임대차보호법, 남녀고용평등)"),
        page: z.number().optional().default(1).describe("페이지 번호 (기본: 1)"),
      }, async (args) => {
        try { return { content: [{ type: "text", text: await searchLaw(args) }] }; }
        catch (e) { return { content: [{ type: "text", text: `검색 오류: ${e.message}` }], isError: true }; }
      }),

      tool("get_law_text", "법령ID(MST)로 법령 본문 전체를 조회합니다. 조문별 내용을 반환합니다.", {
        mst: z.string().describe("법령일련번호 (search_law 결과에서 획득)"),
      }, async (args) => {
        try { return { content: [{ type: "text", text: await getLawText(args) }] }; }
        catch (e) { return { content: [{ type: "text", text: `본문 조회 오류: ${e.message}` }], isError: true }; }
      }),

      tool("search_precedents", "판례를 키워드로 검색합니다. 사건번호, 판결요지 목록을 반환합니다.", {
        query: z.string().describe("검색 키워드 (예: 보증금 반환)"),
        page: z.number().optional().default(1).describe("페이지 번호 (기본: 1)"),
      }, async (args) => {
        try { return { content: [{ type: "text", text: await searchPrecedents(args) }] }; }
        catch (e) { return { content: [{ type: "text", text: `판례 검색 오류: ${e.message}` }], isError: true }; }
      }),

      tool("get_precedent_text", "판례ID로 판례 본문을 조회합니다. 판결요지, 판결이유 등을 반환합니다.", {
        id: z.string().describe("판례 일련번호 (search_precedents 결과에서 획득)"),
      }, async (args) => {
        try { return { content: [{ type: "text", text: await getPrecedentText(args) }] }; }
        catch (e) { return { content: [{ type: "text", text: `판례 조회 오류: ${e.message}` }], isError: true }; }
      }),

      tool("search_admin_rule", "행정규칙(훈령, 예규, 고시 등)을 검색합니다.", {
        query: z.string().describe("검색 키워드"),
      }, async (args) => {
        try { return { content: [{ type: "text", text: await searchAdminRule(args) }] }; }
        catch (e) { return { content: [{ type: "text", text: `행정규칙 검색 오류: ${e.message}` }], isError: true }; }
      }),

      tool("search_ordinance", "지방자치단체 조례를 검색합니다.", {
        query: z.string().describe("검색 키워드 (예: 서울시 주차)"),
      }, async (args) => {
        try { return { content: [{ type: "text", text: await searchOrdinance(args) }] }; }
        catch (e) { return { content: [{ type: "text", text: `조례 검색 오류: ${e.message}` }], isError: true }; }
      }),
    ],
  });
}

module.exports = { createLawMcpServer };
