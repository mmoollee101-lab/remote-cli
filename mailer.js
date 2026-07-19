// mailer.js — Gmail SMTP로 알림 메일 발송 (nodemailer)
// RESTART_EMAIL_USER/PASS(앱 비밀번호)를 재사용한다. 미설정이면 비활성.
const nodemailer = require("nodemailer");

function createMailer({ user, pass, to, log = () => {}, logError = () => {} }) {
  if (!user || !pass) {
    log("[MAILER] RESTART_EMAIL_USER/PASS 미설정 — 알림 메일 비활성.");
    return null;
  }
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  const recipient = to || user;
  log(`[MAILER] 알림 메일 활성화 (수신: ${recipient})`);
  return {
    async sendAlert(subject, text) {
      try {
        await transport.sendMail({ from: user, to: recipient, subject, text });
        log(`[MAILER] 알림 메일 전송: ${subject}`);
        return true;
      } catch (e) {
        logError(`[MAILER] 메일 전송 실패: ${e.message}`);
        return false;
      }
    },
  };
}

module.exports = { createMailer };
