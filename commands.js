// commands.js — Phase 2~4 명령어 핸들러
// Design Ref: §1.4 — 새 명령어 분리, bot.js 경량화
const path = require("path");
const fs = require("fs");
const { exec, execFile } = require("child_process");
const crypto = require("crypto");
const express = require("express");
const cron = require("node-cron");
const CONFIG = require("./config");
const { isInsideWorkingDir, resolveFilePath, registerPath } = require("./utils");

/**
 * Phase 2~4 명령어를 등록합니다.
 * @param {TelegramBot} bot
 * @param {object} ctx — 공유 상태 접근자
 */
module.exports = function registerCommands(bot, ctx) {
  const { isAuthorized, isLockedCheck, safeSend, t } = ctx;

  // ─── /tree [depth] — 디렉토리 구조 ────────────────────────────

  function loadGitignore(dir) {
    try {
      const gitignorePath = path.join(dir, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        return fs.readFileSync(gitignorePath, "utf-8")
          .split("\n")
          .map(l => l.trim())
          .filter(l => l && !l.startsWith("#"));
      }
    } catch {}
    return ["node_modules", "dist", ".git", "__pycache__", ".next"];
  }

  bot.onText(/\/tree(?:\s+(\d+))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;
    const maxDepth = Math.min(parseInt(match[1]) || CONFIG.TREE_DEFAULT_DEPTH, CONFIG.TREE_MAX_DEPTH);

    const ignorePatterns = loadGitignore(ctx.workingDir);

    function buildTree(dir, prefix, depth) {
      if (depth > maxDepth) return "";
      let result = "";
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
          .filter(e => !e.name.startsWith(".") && !ignorePatterns.includes(e.name))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        entries.forEach((entry, i) => {
          const isLast = i === entries.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const childPrefix = isLast ? "    " : "│   ";
          result += `${prefix}${connector}${entry.name}\n`;
          if (entry.isDirectory()) {
            result += buildTree(path.join(dir, entry.name), prefix + childPrefix, depth + 1);
          }
        });
      } catch {}
      return result;
    }

    const dirName = path.basename(ctx.workingDir);
    let tree = `${dirName}/\n` + buildTree(ctx.workingDir, "", 1);

    if (tree.trim() === `${dirName}/`) {
      return safeSend(chatId, t("tree_empty"));
    }

    if (tree.length > 3800) {
      tree = tree.substring(0, 3800) + "\n... (truncated)";
    }

    await safeSend(chatId, `\`\`\`\n${tree}\n\`\`\``, { parse_mode: "Markdown" });
  });

  // ─── Phase 3: 파일 관리 명령어 ────────────────────────────────

  // /delete <path>
  bot.onText(/\/delete(?:\s+(.+))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;
    const input = (match[1] || "").trim();
    if (!input) return safeSend(chatId, t("path_required"));

    const target = resolveFilePath(input, ctx.workingDir);
    if (!isInsideWorkingDir(target, ctx.workingDir)) return safeSend(chatId, t("path_outside"));
    if (!fs.existsSync(target)) return safeSend(chatId, t("path_not_found", { path: input }), { parse_mode: "Markdown" });

    const stat = fs.statSync(target);
    const typeStr = stat.isDirectory() ? t("directory_word") : t("file_word");
    await bot.sendMessage(chatId, t("delete_confirm", { type: typeStr, path: path.relative(ctx.workingDir, target) }), {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: t("btn_confirm_delete"), callback_data: `del_yes_${registerPath(target)}` },
          { text: t("btn_cancel"), callback_data: "del_cancel" },
        ]],
      },
    });
  });

  // /copy, /rename, /move — 공통 2인자 파일 명령어 헬퍼
  async function twoArgFileCmd(msg, match, { usageKey, operation, doneKey, errorKey }) {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;
    const args = (match[1] || "").trim().split(/\s+/);
    if (args.length < 2) return safeSend(chatId, t(usageKey), { parse_mode: "Markdown" });

    const src = resolveFilePath(args[0], ctx.workingDir);
    const dest = resolveFilePath(args[1], ctx.workingDir);
    if (!isInsideWorkingDir(src, ctx.workingDir) || !isInsideWorkingDir(dest, ctx.workingDir)) return safeSend(chatId, t("path_outside"));
    if (!fs.existsSync(src)) return safeSend(chatId, t("path_not_found", { path: args[0] }), { parse_mode: "Markdown" });

    try {
      operation(src, dest);
      safeSend(chatId, t(doneKey, { src: path.relative(ctx.workingDir, src), dest: path.relative(ctx.workingDir, dest), old: path.basename(src), new: path.basename(dest) }), { parse_mode: "Markdown" });
    } catch (err) {
      safeSend(chatId, t(errorKey, { error: err.message }));
    }
  }

  bot.onText(/\/copy(?:\s+(.+))?/, (msg, match) => twoArgFileCmd(msg, match, {
    usageKey: "copy_usage", doneKey: "copy_done", errorKey: "copy_error",
    operation: (src, dest) => fs.cpSync(src, dest, { recursive: true }),
  }));

  bot.onText(/\/rename(?:\s+(.+))?/, (msg, match) => twoArgFileCmd(msg, match, {
    usageKey: "rename_usage", doneKey: "rename_done", errorKey: "rename_error",
    operation: (src, dest) => fs.renameSync(src, dest),
  }));

  bot.onText(/\/move(?:\s+(.+))?/, (msg, match) => twoArgFileCmd(msg, match, {
    usageKey: "move_usage", doneKey: "move_done", errorKey: "move_error",
    operation: (src, dest) => fs.renameSync(src, dest),
  }));

  // /revert — Git 기반 되돌리기
  bot.onText(/\/revert/, async (msg) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;

    const isGit = fs.existsSync(path.join(ctx.workingDir, ".git"));
    if (!isGit) return safeSend(chatId, t("revert_no_git"));

    exec("git diff --stat HEAD", { cwd: ctx.workingDir }, async (err, stdout) => {
      if (!stdout || !stdout.trim()) return safeSend(chatId, t("revert_no_changes"));

      const diff = stdout.trim().length > 3500 ? stdout.trim().substring(0, 3500) + "\n..." : stdout.trim();
      await bot.sendMessage(chatId, t("revert_preview", { diff }), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: t("btn_revert_all"), callback_data: "revert_all" }],
            [{ text: t("btn_revert_code"), callback_data: "revert_code" }],
            [{ text: t("btn_cancel"), callback_data: "revert_cancel" }],
          ],
        },
      });
    });
  });

  // /search <pattern>
  bot.onText(/\/search(?:\s+(.+))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;
    const pattern = (match[1] || "").trim();
    if (!pattern) return safeSend(chatId, t("search_usage"), { parse_mode: "Markdown" });

    const results = [];
    function searchDir(dir, depth) {
      if (depth > 5 || results.length >= 50) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          if (e.name.toLowerCase().includes(pattern.toLowerCase())) {
            results.push(path.relative(ctx.workingDir, path.join(dir, e.name)));
          }
          if (e.isDirectory()) searchDir(path.join(dir, e.name), depth + 1);
        }
      } catch {}
    }
    searchDir(ctx.workingDir, 0);

    if (results.length === 0) return safeSend(chatId, t("search_no_results"));

    const list = results.map((r, i) => `${i + 1}. ${r}`).join("\n");
    await safeSend(chatId, `\`\`\`\n${list}\n\`\`\``, { parse_mode: "Markdown" });
  });

  // /grep <pattern>
  bot.onText(/\/grep(?:\s+(.+))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;
    const pattern = (match[1] || "").trim();
    if (!pattern) return safeSend(chatId, t("grep_usage"), { parse_mode: "Markdown" });

    const args = [
      "-rn", "--include=*.js", "--include=*.ts", "--include=*.py",
      "--include=*.json", "--include=*.md", "--include=*.css", "--include=*.html",
      "-l", pattern, ".",
    ];
    execFile("grep", args, { cwd: ctx.workingDir, timeout: 10000 }, async (err, stdout) => {
      const files = (stdout || "").trim().split("\n").filter(Boolean).slice(0, 20);
      if (files.length === 0) return safeSend(chatId, t("grep_no_results"));

      const list = files.map((f, i) => `${i + 1}. ${f}`).join("\n");
      await safeSend(chatId, `\`\`\`\n${list}\n\`\`\``, { parse_mode: "Markdown" });
    });
  });

  // ─── Phase 4: 자동화 + 외부 연동 ─────────────────────────────

  // Webhook API 서버
  function startWebhookServer() {
    if (ctx.webhookServer) return;

    if (!ctx.webhookToken) {
      ctx.webhookToken = crypto.randomBytes(16).toString("hex");
      ctx.saveState();
      ctx.log(`[WEBHOOK] 토큰 생성됨: ${ctx.webhookToken}`);
    }

    const app = express();
    app.use(express.json());

    app.use((req, res, next) => {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (token !== ctx.webhookToken) return res.status(401).json({ error: "Unauthorized" });
      next();
    });

    app.post("/webhook", async (req, res) => {
      const { title, body, level } = req.body;
      const icon = { info: "ℹ️", warning: "⚠️", error: "🔴" }[level] || "📬";
      const message = `${icon} **Webhook**\n\n**${title || "Event"}**\n${body || ""}`;
      try {
        await safeSend(ctx.AUTHORIZED_USER_ID, message, { parse_mode: "Markdown" });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post("/webhook/run", async (req, res) => {
      const { prompt, dir } = req.body;
      if (!prompt) return res.status(400).json({ error: "prompt required" });
      if (dir) {
        try {
          const resolved = path.resolve(dir);
          if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            return res.status(400).json({ error: "dir not found or not a directory" });
          }
        } catch {
          return res.status(400).json({ error: "invalid dir" });
        }
      }
      const fullPrompt = dir ? `[Working directory: ${dir}]\n${prompt}` : prompt;
      ctx.processMessage(ctx.AUTHORIZED_USER_ID, fullPrompt);
      res.json({ ok: true, queued: true });
    });

    ctx.webhookServer = app.listen(CONFIG.WEBHOOK_PORT, () => {
      ctx.log(`[WEBHOOK] 서버 시작 — port ${CONFIG.WEBHOOK_PORT}`);
    });
    ctx.webhookServer.on("error", (err) => {
      ctx.logError(`[WEBHOOK] 서버 오류: ${err.message}`);
      ctx.webhookServer = null;
    });
  }

  // /webhook [status|start|stop|token]
  bot.onText(/\/webhook(?:\s+(.+))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;
    const sub = (match[1] || "status").trim().toLowerCase();

    if (sub === "start") {
      startWebhookServer();
      return safeSend(chatId, t("webhook_started", { port: CONFIG.WEBHOOK_PORT, token: ctx.webhookToken }), { parse_mode: "Markdown" });
    }
    if (sub === "stop") {
      if (ctx.webhookServer) { ctx.webhookServer.close(); ctx.webhookServer = null; }
      return safeSend(chatId, t("webhook_stopped"));
    }
    if (sub === "token") {
      return safeSend(chatId, `Token: \`${ctx.webhookToken || "(없음)"}\``, { parse_mode: "Markdown" });
    }
    if (ctx.webhookServer) {
      safeSend(chatId, t("webhook_status_on", { port: CONFIG.WEBHOOK_PORT }));
    } else {
      safeSend(chatId, t("webhook_status_off"), { parse_mode: "Markdown" });
    }
  });

  // /schedule "cron" "command"
  bot.onText(/\/schedule(?:\s+"([^"]+)"\s+"([^"]+)")?/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;

    if (!match[1] || !match[2]) return safeSend(chatId, t("schedule_usage"), { parse_mode: "Markdown" });

    const expression = match[1];
    const command = match[2];

    if (!cron.validate(expression)) return safeSend(chatId, t("schedule_invalid_cron"));
    if (ctx.cronJobs.size >= CONFIG.CRON_MAX_JOBS) return safeSend(chatId, t("schedule_max_reached", { max: CONFIG.CRON_MAX_JOBS }));

    const id = String(++ctx.cronCounter);
    const job = cron.schedule(expression, () => {
      ctx.log(`[CRON] 실행: ${command}`);
      exec(command, { cwd: ctx.workingDir, timeout: 60000 }, async (err, stdout) => {
        const result = err ? `❌ ${err.message}` : (stdout || "(no output)");
        await safeSend(ctx.AUTHORIZED_USER_ID, t("cron_result", { id, command, result: result.substring(0, 1000) }), { parse_mode: "Markdown" });
      });
    });

    ctx.cronJobs.set(id, { expression, command, job });
    ctx.saveState();
    safeSend(chatId, t("schedule_created", { id, expression, command }), { parse_mode: "Markdown" });
  });

  // /schedules
  bot.onText(/\/schedules/, async (msg) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;

    if (ctx.cronJobs.size === 0) return safeSend(chatId, t("schedule_none"));
    const list = [...ctx.cronJobs.entries()]
      .map(([id, j]) => `#${id}: \`${j.expression}\` → \`${j.command}\``)
      .join("\n");
    safeSend(chatId, list, { parse_mode: "Markdown" });
  });

  // /unschedule <id>
  bot.onText(/\/unschedule(?:\s+(\d+))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;
    const id = match[1];
    const entry = ctx.cronJobs.get(id);
    if (!entry) return safeSend(chatId, t("schedule_not_found"));
    entry.job.stop();
    ctx.cronJobs.delete(id);
    ctx.saveState();
    safeSend(chatId, t("schedule_removed", { id }));
  });

  // /teleport
  bot.onText(/\/teleport/, async (msg) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;

    if (!ctx.sessionId) return safeSend(chatId, t("teleport_no_session"));

    const command = `claude --resume ${ctx.sessionId}`;
    try { exec(`echo|set /p="${command.replace(/"/g, "")}"| clip`, { cwd: ctx.workingDir }); } catch {}

    await safeSend(chatId, t("teleport_info", {
      sessionId: ctx.sessionId, dir: ctx.workingDir, command,
    }), { parse_mode: "Markdown" });
  });

  // /verbose [0|1|2]
  bot.onText(/\/verbose(?:\s+(\d+))?/, async (msg, match) => {
    if (!isAuthorized(msg)) return;
    if (isLockedCheck(msg)) return;
    const chatId = msg.chat.id;
    const level = parseInt(match[1]);
    if (isNaN(level) || level < 0 || level > 2) {
      return safeSend(chatId, t("verbose_usage", { current: ctx.currentVerbosity }), { parse_mode: "Markdown" });
    }
    ctx.currentVerbosity = level;
    ctx.saveState();
    const labels = [t("verbose_quiet"), t("verbose_normal"), t("verbose_detailed")];
    safeSend(chatId, t("verbose_set", { level, label: labels[level] }));
  });

  return { startWebhookServer };
};
