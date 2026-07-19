// restart-control.js — 웹 링크로 봇 재시작 (텔레그램이 죽어도 클릭 한 번으로 복구)
//
// RESTART_WEB_TOKEN 이 설정된 경우에만 활성화된다. 전용 HTTP 창구를 열고
// cloudflared 터널로 공개 주소를 만들어, 다음 링크로 재시작할 수 있다:
//   <url>/restart/law/<token>   → 법률봇 재시작
//   <url>/restart/main/<token>  → 메인봇 재시작
// quick 터널은 재시작 시 주소가 바뀌므로, 시작할 때마다 현재 링크를 관리자에게 보낸다.
const express = require("express");

function page(title, msg) {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 20px">` +
    `<h2>${title}</h2><p style="color:#555">${msg}</p></body></html>`;
}

async function startWebRestart({ token, port, onLawRestart, onMainRestart, log, logError }) {
  if (!token) {
    log("[WEBRESTART] RESTART_WEB_TOKEN 미설정 — 웹 링크 재시작 비활성.");
    return null;
  }

  const app = express();

  app.get("/restart/law/:t", (req, res) => {
    if (req.params.t !== token) return res.status(403).send(page("접근 거부", "잘못된 토큰입니다."));
    try { onLawRestart(); log("[WEBRESTART] 웹 링크로 법률봇 재시작 요청됨"); }
    catch (e) { logError(`[WEBRESTART] 법률봇 트리거 실패: ${e.message}`); }
    res.send(page("✅ 법률봇 재시작 요청됨", "잠시 후 재시작됩니다. 이 창은 닫아도 됩니다."));
  });

  app.get("/restart/main/:t", (req, res) => {
    if (req.params.t !== token) return res.status(403).send(page("접근 거부", "잘못된 토큰입니다."));
    res.send(page("✅ 메인봇 재시작 요청됨", "곧 재시작됩니다. 이 창은 닫아도 됩니다."));
    setTimeout(() => { try { onMainRestart(); } catch {} }, 500);
  });

  app.get("/", (_req, res) => res.send(page("Restart Control", "정상 동작 중")));

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, () => resolve(s));
    s.on("error", reject);
  });
  log(`[WEBRESTART] HTTP 창구 시작 (port ${port})`);

  let tunnel = null;
  let baseUrl = null;
  try {
    const { Tunnel } = await import("cloudflared");
    tunnel = Tunnel.quick(`http://localhost:${port}`);
    baseUrl = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("tunnel URL timeout (30s)")), 30000);
      tunnel.once("url", (u) => { clearTimeout(to); resolve(u); });
      tunnel.once("error", (e) => { clearTimeout(to); reject(e); });
    });
    log(`[WEBRESTART] 터널 준비됨: ${baseUrl}`);
    tunnel.on("exit", () => logError("[WEBRESTART] 터널 프로세스 종료됨"));
  } catch (e) {
    logError(`[WEBRESTART] 터널 시작 실패(HTTP 창구는 동작): ${e.message}`);
  }

  return {
    lawUrl: baseUrl ? `${baseUrl}/restart/law/${token}` : null,
    mainUrl: baseUrl ? `${baseUrl}/restart/main/${token}` : null,
    stop() {
      try { if (tunnel) tunnel.stop(); } catch {}
      try { if (server) server.close(); } catch {}
    },
  };
}

module.exports = { startWebRestart };
