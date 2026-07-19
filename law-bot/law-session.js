// law-session.js — 사용자별 웜(warm) 세션 풀
//
// 매 질문마다 Claude Code CLI를 새로 띄우면 ~10초 콜드스타트가 발생한다(측정치).
// 이를 없애기 위해 SDK를 "스트리밍 입력 모드"로 열어 세션(서브프로세스)을 살려두고
// 재사용한다. 두 번째 질문부터는 부팅 비용이 사라져 수 초 내 응답한다.
//
// 추가로 항상 1개의 예열된 '스페어' 세션을 준비해 두어, 유휴 상태 후
// 첫 질문도 콜드스타트를 겪지 않도록 한다.

function makeInputQueue() {
  const buf = [];
  let resolveNext = null;
  let ended = false;
  return {
    push(msg) {
      if (resolveNext) { resolveNext({ value: msg, done: false }); resolveNext = null; }
      else buf.push(msg);
    },
    end() {
      ended = true;
      if (resolveNext) { resolveNext({ value: undefined, done: true }); resolveNext = null; }
    },
    iterable: {
      next() {
        if (buf.length) return Promise.resolve({ value: buf.shift(), done: false });
        if (ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => { resolveNext = r; });
      },
      [Symbol.asyncIterator]() { return this; },
    },
  };
}

const userMsg = (text) => ({ type: "user", message: { role: "user", content: text } });

function createSessionManager({
  sdkQuery, buildOptions,
  idleMs = 30 * 60 * 1000,     // 30분 유휴 시 세션 종료
  turnTimeoutMs = 120000,      // 한 턴 최대 대기
  log = () => {}, logError = () => {},
}) {
  const pool = new Map();      // userId -> session
  let spare = null;            // 예열된 미할당 세션
  let warming = false;

  function newSession() {
    const input = makeInputQueue();
    const q = sdkQuery({ prompt: input.iterable, options: buildOptions() });
    const iterator = q[Symbol.asyncIterator]();
    const s = { input, iterator, busy: false, lastUsed: Date.now(), alive: true, ready: false };
    // 사전 예열: 사용자 입력 없이도 system(init) 메시지까지 소비해 프로세스를 띄워 둔다.
    s.readyPromise = (async () => {
      try {
        while (true) {
          const { value: m, done } = await iterator.next();
          if (done) { s.alive = false; return; }
          if (m && m.type === "system") { s.ready = true; return; }
        }
      } catch (e) {
        s.alive = false;
        logError(`[SESSION] 예열 실패: ${e.message}`);
      }
    })();
    return s;
  }

  function ensureSpare() {
    if (spare || warming) return;
    warming = true;
    try {
      spare = newSession();
      spare.readyPromise.finally(() => { warming = false; });
    } catch (e) {
      warming = false;
      logError(`[SESSION] 스페어 생성 실패: ${e.message}`);
    }
  }

  function drop(userId, s) {
    try { s.alive = false; s.input.end(); } catch {}
    try { if (s.iterator.return) s.iterator.return(); } catch {}
    if (userId && pool.get(userId) === s) pool.delete(userId);
  }

  function acquire(userId) {
    let s = pool.get(userId);
    if (s && s.alive) return s;
    if (spare && spare.alive) {
      s = spare; spare = null;
      pool.set(userId, s);
      setImmediate(ensureSpare);   // 다음을 위해 다시 예열
      return s;
    }
    s = newSession();
    pool.set(userId, s);
    setImmediate(ensureSpare);
    return s;
  }

  async function ask(userId, prompt, onPartial, onColdStart) {
    let s = acquire(userId);
    // 세션이 아직 예열되지 않았으면(콜드) 호출자에게 알림 → "준비 중" 안내 표시
    if (!s.ready && onColdStart) { try { onColdStart(); } catch {} }
    // 예열 완료 대기(이미 떠 있으면 즉시 통과)
    if (s.readyPromise) { try { await s.readyPromise; } catch {} }
    if (!s.alive) {                // 예열 중 죽었으면 한 번 더 새로 시도
      drop(userId, s);
      s = acquire(userId);
      if (s.readyPromise) { try { await s.readyPromise; } catch {} }
      if (!s.alive) throw new Error("세션 초기화에 실패했습니다.");
    }

    s.busy = true; s.lastUsed = Date.now();
    let resultText = "";
    const deadline = Date.now() + turnTimeoutMs;
    try {
      s.input.push(userMsg(prompt));
      while (true) {
        const remain = deadline - Date.now();
        if (remain <= 0) throw new Error("응답 시간 초과");
        const { value: message, done } = await Promise.race([
          s.iterator.next(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("응답 시간 초과")), remain)),
        ]);
        if (done) { drop(userId, s); break; }
        if (message.type === "assistant" && message.message && message.message.content) {
          for (const block of message.message.content) {
            if (block.type === "text" && block.text) resultText += block.text;
          }
          if (onPartial && resultText.trim()) { try { await onPartial(resultText); } catch {} }
        } else if (message.type === "result") {
          if (message.subtype === "success" && message.result && !resultText.trim()) {
            resultText = message.result;
          }
          break;
        }
      }
    } catch (e) {
      drop(userId, s);           // 타임아웃/오류 시 세션 폐기(다음 질문은 새로 예열)
      throw e;
    } finally {
      s.busy = false; s.lastUsed = Date.now();
    }
    return resultText.trim();
  }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [uid, s] of pool) {
      if (!s.busy && now - s.lastUsed > idleMs) {
        log(`[SESSION] 유휴 세션 종료 (user ${uid})`);
        drop(uid, s);
      }
    }
  }, 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  function shutdown() {
    clearInterval(sweeper);
    for (const [uid, s] of pool) drop(uid, s);
    if (spare) { try { spare.input.end(); } catch {} spare = null; }
  }

  // 사용자의 대화 맥락 초기화(/new): 세션을 폐기해 다음 질문이 새 맥락으로 시작
  function reset(userId) {
    const s = pool.get(String(userId));
    if (s) drop(String(userId), s);
  }

  ensureSpare(); // 시작 시 1개 예열
  return { ask, reset, shutdown, ensureSpare };
}

module.exports = { createSessionManager };
