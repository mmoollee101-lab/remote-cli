// mail-trigger.js — 이메일로 봇 재시작 신호 수신 (dead-man's switch 복구용)
// RESTART_EMAIL_USER / RESTART_EMAIL_PASS(Gmail 앱 비밀번호)가 설정된 경우에만 활성화.
// 허용된 발신자가 지정 제목의 메일을 보내면 재시작 트리거를 만든다.
//   제목에 "LAWBOT RESTART"  → law-bot/restart.trigger 생성 (법률봇 런처가 감지→재시작)
//   제목에 "MAINBOT RESTART" → 메인봇 스스로 재시작(exit 82)
// 텔레그램이 끊겨도 node 프로세스만 살아있으면 이 경로로 원격 복구가 가능하다.
const fs = require("fs");
const path = require("path");

function startMailTrigger({ log, logError, onMainRestart }) {
  const USER = (process.env.RESTART_EMAIL_USER || "").trim();
  const PASS = (process.env.RESTART_EMAIL_PASS || "").trim();
  if (!USER || !PASS) {
    log("[MAIL] RESTART_EMAIL_USER/PASS 미설정 — 이메일 재시작 비활성.");
    return null;
  }

  const ALLOWED_FROM = (process.env.RESTART_EMAIL_FROM || USER).trim().toLowerCase();
  const HOST = process.env.RESTART_EMAIL_HOST || "imap.gmail.com";
  const PORT = parseInt(process.env.RESTART_EMAIL_PORT || "993", 10);
  const INTERVAL = parseInt(process.env.RESTART_EMAIL_INTERVAL || "120000", 10); // 2분

  let ImapFlow;
  try {
    ({ ImapFlow } = require("imapflow"));
  } catch (err) {
    logError(`[MAIL] imapflow 로드 실패 — 'npm install imapflow' 필요: ${err.message}`);
    return null;
  }

  const LAW_TRIGGER = path.join(__dirname, "law-bot", "restart.trigger");
  let polling = false;

  async function poll() {
    if (polling) return; // 이전 폴링이 안 끝났으면 건너뜀
    polling = true;
    const client = new ImapFlow({
      host: HOST, port: PORT, secure: true,
      auth: { user: USER, pass: PASS },
      logger: false,
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        for (const uid of uids || []) {
          const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
          if (!msg || !msg.envelope) continue;
          const from = (msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address || "").toLowerCase();
          const subject = (msg.envelope.subject || "").toUpperCase();
          if (from !== ALLOWED_FROM) continue;

          if (subject.includes("LAWBOT RESTART")) {
            try {
              fs.writeFileSync(LAW_TRIGGER, new Date().toISOString());
              log("[MAIL] 'LAWBOT RESTART' 수신 → 법률봇 트리거 생성");
            } catch (e) { logError(`[MAIL] 트리거 생성 실패: ${e.message}`); }
            try { await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true }); } catch {}
          } else if (subject.includes("MAINBOT RESTART")) {
            log("[MAIL] 'MAINBOT RESTART' 수신 → 메인봇 재시작");
            try { await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true }); } catch {}
            lock.release();
            try { await client.logout(); } catch {}
            polling = false;
            if (onMainRestart) onMainRestart();
            return;
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      logError(`[MAIL] 폴링 오류: ${err.message}`);
      try { await client.logout(); } catch {}
    } finally {
      polling = false;
    }
  }

  log(`[MAIL] 이메일 재시작 감시 활성화 (${HOST}, ${Math.round(INTERVAL / 1000)}초 주기, 허용 발신자: ${ALLOWED_FROM})`);
  poll();
  const timer = setInterval(poll, INTERVAL);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { startMailTrigger };
