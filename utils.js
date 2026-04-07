// utils.js — 순수 유틸리티 함수 모음
// Design Ref: §1.3 — bot.js에서 독립적인 헬퍼 분리
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");

// ─── 마크다운 테이블 → 코드블록 변환 ─────────────────────────────
function convertMarkdownTables(text) {
  const lines = text.split("\n");
  const result = [];
  let tableLines = [];
  let inTable = false;
  let inCodeBlock = false;

  for (const line of lines) {
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

// ─── Telegraph Instant View ───────────────────────────────────────
async function createTelegraphPage(title, content) {
  const nodes = [];
  const parts = content.split(/```(\w*)\n?([\s\S]*?)```/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0 && parts[i].trim()) {
      for (const line of parts[i].split("\n\n")) {
        if (line.trim()) nodes.push({ tag: "p", children: [line.trim()] });
      }
    } else if (i % 3 === 2 && parts[i].trim()) {
      nodes.push({ tag: "pre", children: [parts[i]] });
    }
  }
  if (nodes.length === 0) nodes.push({ tag: "p", children: [content.substring(0, 60000)] });

  const body = JSON.stringify({
    title: title.substring(0, 200),
    author_name: "Claude Bot",
    content: JSON.stringify(nodes),
  });

  return new Promise((resolve) => {
    const req = https.request("https://api.telegra.ph/createPage", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ok ? json.result.url : null);
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ─── 경로 보안 ────────────────────────────────────────────────────
function isInsideWorkingDir(filePath, baseDir) {
  const resolved = path.resolve(filePath);
  const base = path.resolve(baseDir);
  if (process.platform === "win32") {
    return resolved.toLowerCase().startsWith(base.toLowerCase());
  }
  return resolved.startsWith(base);
}

function resolveFilePath(input, baseDir) {
  if (!input) return null;
  return path.resolve(baseDir, input.trim());
}

// ─── 경로 ID 매핑 (callback_data 64바이트 제한 대응) ─────────────
const pathIdMap = new Map();
let pathIdCounter = 0;

function registerPath(filePath) {
  const id = String(++pathIdCounter);
  pathIdMap.set(id, filePath);
  return id;
}

function lookupPath(id) {
  return pathIdMap.get(id) || null;
}

// ─── 파일 경로 감지 + 버튼 빌더 ──────────────────────────────────
const FILE_PATH_REGEX = /(?:^|\s)((?:[A-Z]:\\|\/)[^\s"'<>|*?]+\.[a-zA-Z0-9]+)/gm;

function extractFilePaths(text, workingDir) {
  const paths = [];
  let match;
  FILE_PATH_REGEX.lastIndex = 0;
  while ((match = FILE_PATH_REGEX.exec(text)) !== null) {
    const p = match[1].trim();
    try {
      const resolved = path.resolve(p);
      if (isInsideWorkingDir(resolved, workingDir) && fs.existsSync(resolved)) {
        paths.push(resolved);
      }
    } catch {}
  }
  return [...new Set(paths)];
}

function buildFileButtons(filePaths) {
  return filePaths.slice(0, 5).map(fp => {
    const name = path.basename(fp);
    const id = registerPath(fp);
    return [
      { text: `📄 ${name}`, callback_data: `fview_${id}` },
      { text: `📥 Download`, callback_data: `fdown_${id}` },
    ];
  });
}

// ─── 번호 목록 → 인라인 버튼 ─────────────────────────────────────
const NUMBERED_LIST_REGEX = /^(\d+)\.\s+(.+)$/gm;

function extractNumberedOptions(text) {
  const options = [];
  let match;
  NUMBERED_LIST_REGEX.lastIndex = 0;
  while ((match = NUMBERED_LIST_REGEX.exec(text)) !== null) {
    if (options.length < 8) {
      options.push({ num: match[1], label: match[2].trim().substring(0, 40) });
    }
  }
  if (options.length < 3) return [];
  const isSequential = options.every((o, i) => parseInt(o.num) === i + 1);
  return isSequential ? options : [];
}

function buildOptionButtons(options) {
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
  const direct = path.resolve(description.trim());
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }

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

  if (basePaths.length === 0) {
    basePaths = [
      path.join(home, "OneDrive", "바탕 화면"),
      path.join(home, "Desktop"),
      path.join(home, "Documents"),
      path.join(home, "OneDrive", "문서"),
      home,
    ];
  }

  const tokens = desc.split(/\s+/).filter((t) => t.length >= 2 && !KOREAN_STOPWORDS.has(t));
  for (const loc of locationMap) {
    for (const kw of loc.keywords) {
      const idx = tokens.indexOf(kw);
      if (idx !== -1) tokens.splice(idx, 1);
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].startsWith(kw)) {
          tokens[i] = tokens[i].slice(kw.length);
          if (tokens[i].length < 2 || KOREAN_STOPWORDS.has(tokens[i])) tokens.splice(i, 1);
        }
      }
    }
  }

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

module.exports = {
  convertMarkdownTables,
  createTelegraphPage,
  isInsideWorkingDir,
  resolveFilePath,
  registerPath,
  lookupPath,
  extractFilePaths,
  buildFileButtons,
  extractNumberedOptions,
  buildOptionButtons,
  resolveDirectory,
};
