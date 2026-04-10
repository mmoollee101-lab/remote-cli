using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

class TrayLauncher
{
    static Process botProcess;
    static Process lawBotProcess;
    static NotifyIcon trayIcon;
    static string logPath;
    static string botToken;
    static string chatId;
    static string computerName;
    static System.Threading.Mutex appMutex;
    static readonly string AutoStartKey = "ClaudeTelegramBot";

    static string currentLang = "ko";
    static string botStatePath;
    static string botDir;
    static string botJsPath;
    static string lawBotDir;
    static string lawBotJsPath;
    static bool setupNotified = false;
    static bool lawBotEnabled = false;
    static bool lawBotAutoStart = false;
    static int lawBotCrashCount = 0;
    static DateTime lawBotLastStart = DateTime.MinValue;

    // 시스템 + 사용자 PATH를 합쳐서 완전한 PATH 생성
    static string GetFullPath()
    {
        string machinePath = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) ?? "";
        string userPath = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? "";
        string processPath = Environment.GetEnvironmentVariable("PATH") ?? "";
        System.Collections.Generic.HashSet<string> seen = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        System.Collections.Generic.List<string> parts = new System.Collections.Generic.List<string>();
        foreach (string src in new string[] { processPath, userPath, machinePath })
        {
            foreach (string dir in src.Split(';'))
            {
                string trimmed = dir.Trim();
                if (trimmed.Length > 0 && seen.Add(trimmed))
                    parts.Add(trimmed);
            }
        }
        return string.Join(";", parts);
    }

    static string fullPath;

    static string FindNodePath()
    {
        foreach (string dir in fullPath.Split(';'))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            string candidate = Path.Combine(dir.Trim(), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        string[] commonPaths = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            @"C:\Program Files\nodejs\node.exe"
        };
        foreach (string p in commonPaths)
        {
            if (File.Exists(p)) return p;
        }
        return "node";
    }

    static ProcessStartInfo CreateNodeStartInfo(string botJs, string dir)
    {
        string nodePath = FindNodePath();
        ProcessStartInfo psi = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = "\"" + botJs + "\"",
            WorkingDirectory = dir,
            WindowStyle = ProcessWindowStyle.Hidden,
            CreateNoWindow = true,
            UseShellExecute = false
        };
        psi.EnvironmentVariables["PATH"] = fullPath;
        return psi;
    }

    // ─── i18n ────────────────────────────────────────────────────
    static string ReadLangFromState()
    {
        try
        {
            if (File.Exists(botStatePath))
            {
                string content = File.ReadAllText(botStatePath, Encoding.UTF8);
                Match m = Regex.Match(content, "\"lang\"\\s*:\\s*\"(\\w+)\"");
                if (m.Success) return m.Groups[1].Value;
            }
        }
        catch { }
        return "ko";
    }

    static void WriteLangToState(string lang)
    {
        try
        {
            if (File.Exists(botStatePath))
            {
                string content = File.ReadAllText(botStatePath, Encoding.UTF8);
                if (Regex.IsMatch(content, "\"lang\"\\s*:\\s*\"\\w+\""))
                {
                    content = Regex.Replace(content, "\"lang\"\\s*:\\s*\"\\w+\"", "\"lang\": \"" + lang + "\"");
                }
                else
                {
                    // "lang" 키가 없으면 첫 번째 { 뒤에 추가
                    int braceIdx = content.IndexOf('{');
                    if (braceIdx >= 0)
                        content = content.Substring(0, braceIdx + 1) + "\n  \"lang\": \"" + lang + "\"," + content.Substring(braceIdx + 1);
                }
                File.WriteAllText(botStatePath, content, Encoding.UTF8);
            }
            else
            {
                File.WriteAllText(botStatePath, "{\n  \"lang\": \"" + lang + "\"\n}", Encoding.UTF8);
            }
        }
        catch { }
    }

    static bool ReadLawBotAutoStart()
    {
        try
        {
            if (File.Exists(botStatePath))
            {
                string content = File.ReadAllText(botStatePath, Encoding.UTF8);
                Match m = Regex.Match(content, "\"lawBotAutoStart\"\\s*:\\s*(true|false)");
                if (m.Success) return m.Groups[1].Value == "true";
            }
        }
        catch { }
        return false;
    }

    static void WriteLawBotAutoStart(bool enabled)
    {
        try
        {
            string val = enabled ? "true" : "false";
            if (File.Exists(botStatePath))
            {
                string content = File.ReadAllText(botStatePath, Encoding.UTF8);
                if (Regex.IsMatch(content, "\"lawBotAutoStart\"\\s*:\\s*(true|false)"))
                {
                    content = Regex.Replace(content, "\"lawBotAutoStart\"\\s*:\\s*(true|false)", "\"lawBotAutoStart\": " + val);
                }
                else
                {
                    int braceIdx = content.IndexOf('{');
                    if (braceIdx >= 0)
                        content = content.Substring(0, braceIdx + 1) + "\n  \"lawBotAutoStart\": " + val + "," + content.Substring(braceIdx + 1);
                }
                File.WriteAllText(botStatePath, content, Encoding.UTF8);
            }
            else
            {
                File.WriteAllText(botStatePath, "{\n  \"lawBotAutoStart\": " + val + "\n}", Encoding.UTF8);
            }
        }
        catch { }
    }

    static string L(string key)
    {
        if (currentLang == "en")
        {
            switch (key)
            {
                case "guide": return "📖 Guide";
                case "log": return "📋 View Log";
                case "env": return "⚙️ Settings";
                case "autostart": return "🚀 Start with Windows";
                case "restart": return "🔄 Restart";
                case "rebuild": return "🔨 Rebuild & Restart";
                case "quit": return "❌ Quit";
                case "language": return "🌐 Language";
                case "guide_title": return "Claude Telegram Bot - Guide";
                case "guide_subtitle": return "Setup Guide";
                case "already_running": return "Already running.";
                case "bot_not_found": return "bot.js not found.\n\nPath: {0}\n\nThis exe must be inside the dist/ folder.";
                case "node_not_found": return "node.exe not found.\n\nPlease install Node.js.\nhttps://nodejs.org";
                case "bot_stopped": return "🔴 Bot has been stopped.";
                case "setup_needed": return ".env not configured.\nRight-click tray icon → Edit .env → set token → Restart.";
                case "env_setup_title": return "Settings";
                case "env_guide": return "Step 1. Telegram → @BotFather → /newbot → copy the token\n             → paste below → click Save\n\nStep 2. After bot starts, send /start in Telegram\n             → User ID appears → right-click tray → Settings\n             → paste User ID → Save";
                case "env_token_hint": return "@BotFather → /newbot → copy the token";
                case "env_userid_hint": return "Send /start to bot after first launch, ID appears in chat";
                case "env_name_hint": return "Shown in Telegram. Useful for multiple PCs";
                case "env_openai_hint": return "Optional — for voice messages. Get key at platform.openai.com → API Keys";
                case "env_save": return "💾 Save";
                case "env_cancel": return "Close";
                case "env_saved": return "✅ Saved!";
                case "env_token_required": return "Bot Token is required.";
                case "lawbot": return "Legal Bot";
                case "lawbot_start": return "Start Legal Bot";
                case "lawbot_stop": return "Stop Legal Bot";
                case "lawbot_settings": return "Legal Bot Settings";
                case "lawbot_log": return "Legal Bot Log";
                case "lawbot_running": return "Legal Bot is running";
                case "lawbot_stopped": return "Legal Bot is stopped";
                case "lawbot_env_title": return "Legal Bot Settings";
                case "lawbot_env_guide": return "Step 1. Telegram \u2192 @BotFather \u2192 /newbot\n             \u2192 Create a SEPARATE bot for legal questions\n             \u2192 Copy the token \u2192 paste below\n\nStep 2. Go to open.law.go.kr \u2192 Sign up \u2192 Get API key\n             \u2192 Paste API key below\n\nStep 3. Send /start to the legal bot in Telegram\n             \u2192 Copy User IDs of family members\n             \u2192 Paste below (comma separated)";
                case "lawbot_token_hint": return "Create a NEW bot via @BotFather (separate from remote-cli bot)";
                case "lawbot_oc_hint": return "Register at open.law.go.kr \u2192 My Page \u2192 API Key";
                case "lawbot_users_hint": return "Comma separated Telegram User IDs (e.g. 123456,789012)";
                case "lawbot_token_required": return "Telegram Bot Token is required.";
                case "lawbot_oc_required": return "Law API Key is required.";
                case "lawbot_not_configured": return "Legal Bot is not configured.\nRight-click tray \u2192 Legal Bot \u2192 Settings";
                case "lawbot_guide_title": return "Legal Bot";
                case "lawbot_guide_tab": return "Legal Bot";
            }
        }
        // Korean (default)
        switch (key)
        {
            case "guide": return "📖 설명서";
            case "log": return "📋 로그 보기";
            case "env": return "⚙️ 설정";
            case "autostart": return "🚀 윈도우 시작 시 자동 실행";
            case "restart": return "🔄 재시작";
            case "rebuild": return "🔨 재빌드 후 재시작";
            case "quit": return "❌ 종료";
            case "language": return "🌐 Language";
            case "guide_title": return "Claude Telegram Bot - 설명서";
            case "guide_subtitle": return "설정 가이드";
            case "already_running": return "이미 실행 중입니다.";
            case "bot_not_found": return "bot.js not found.\n\n경로: {0}\n\ndist/ 폴더 안에 이 exe가 있어야 합니다.";
            case "node_not_found": return "node.exe를 찾을 수 없습니다.\n\nNode.js가 설치되어 있는지 확인하세요.\nhttps://nodejs.org";
            case "bot_stopped": return "🔴 봇이 꺼졌습니다.";
            case "setup_needed": return ".env가 설정되지 않았습니다.\n트레이 아이콘 우클릭 → .env 편집 → 토큰 입력 → 재시작";
            case "env_setup_title": return "설정";
            case "env_guide": return "1단계. 텔레그램 → @BotFather → /newbot → 토큰 복사\n             → 아래에 붙여넣기 → 저장\n\n2단계. 봇 시작 후 텔레그램에서 /start 전송\n             → 유저 ID가 표시됨 → 트레이 우클릭 → 설정\n             → 유저 ID 붙여넣기 → 저장";
            case "env_token_hint": return "@BotFather → /newbot → 발급된 토큰 복사";
            case "env_userid_hint": return "첫 실행 후 봇에 /start 보내면 채팅에 ID가 표시됩니다";
            case "env_name_hint": return "텔레그램에 표시됨. 여러 PC 구분용";
            case "env_openai_hint": return "선택 — 음성 메시지 지원용. platform.openai.com → API Keys에서 발급";
            case "env_save": return "💾 저장";
            case "env_cancel": return "닫기";
            case "env_saved": return "✅ 저장됨!";
            case "env_token_required": return "Bot Token은 필수입니다.";
            case "lawbot": return "법률 봇";
            case "lawbot_start": return "법률 봇 시작";
            case "lawbot_stop": return "법률 봇 중지";
            case "lawbot_settings": return "법률 봇 설정";
            case "lawbot_log": return "법률 봇 로그";
            case "lawbot_running": return "법률 봇 실행 중";
            case "lawbot_stopped": return "법률 봇 중지됨";
            case "lawbot_env_title": return "법률 봇 설정";
            case "lawbot_env_guide": return "1단계. 텔레그램 → @BotFather → /newbot\n             → 법률 질문용 봇을 별도로 만드세요\n             → 토큰 복사 → 아래에 붙여넣기\n\n2단계. open.law.go.kr 접속 → 회원가입 → API 키 발급\n             → 아래에 API 키 붙여넣기\n\n3단계. 법률 봇에 /start 전송\n             → 가족 멤버들의 유저 ID 복사\n             → 아래에 쉼표로 구분하여 붙여넣기";
            case "lawbot_token_hint": return "@BotFather에서 새 봇 생성 (원격 제어 봇과 별도로)";
            case "lawbot_oc_hint": return "open.law.go.kr → 마이페이지 → API 키 발급";
            case "lawbot_users_hint": return "텔레그램 유저 ID를 쉼표로 구분 (예: 123456,789012)";
            case "lawbot_token_required": return "텔레그램 봇 토큰은 필수입니다.";
            case "lawbot_oc_required": return "법제처 API 키는 필수입니다.";
            case "lawbot_not_configured": return "법률 봇이 설정되지 않았습니다.\n트레이 우클릭 → 법률 봇 → 설정";
            case "lawbot_guide_title": return "법률 봇";
            case "lawbot_guide_tab": return "법률 봇";
        }
        return key;
    }

    static void BuildMenu()
    {
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Font = new Font("Malgun Gothic", 9);
        menu.Items.Add(L("guide"), null, (s, e) => ShowGuide());
        menu.Items.Add(L("log"), null, (s, e) => OpenLog());
        menu.Items.Add(L("env"), null, (s, e) => ShowEnvSetupDialog());
        menu.Items.Add(new ToolStripSeparator());
        ToolStripMenuItem autoStartItem = new ToolStripMenuItem(L("autostart"));
        autoStartItem.Checked = IsAutoStartEnabled();
        autoStartItem.Click += (s, e) =>
        {
            ToggleAutoStart();
            autoStartItem.Checked = IsAutoStartEnabled();
        };
        menu.Items.Add(autoStartItem);

        // Language submenu
        ToolStripMenuItem langMenu = new ToolStripMenuItem(L("language"));
        ToolStripMenuItem koItem = new ToolStripMenuItem("한국어");
        koItem.Checked = (currentLang == "ko");
        koItem.Click += (s, e) => SwitchLanguage("ko");
        ToolStripMenuItem enItem = new ToolStripMenuItem("English");
        enItem.Checked = (currentLang == "en");
        enItem.Click += (s, e) => SwitchLanguage("en");
        langMenu.DropDownItems.Add(koItem);
        langMenu.DropDownItems.Add(enItem);
        menu.Items.Add(langMenu);

        // Law Bot submenu
        if (Directory.Exists(lawBotDir))
        {
            menu.Items.Add(new ToolStripSeparator());
            ToolStripMenuItem lawMenu = new ToolStripMenuItem(L("lawbot") + (IsLawBotRunning() ? " \u2705" : ""));
            bool lawRunning = IsLawBotRunning();
            ToolStripMenuItem lawStartItem = new ToolStripMenuItem(lawRunning ? L("lawbot_stop") : L("lawbot_start"));
            lawStartItem.Click += (s, e) => {
                if (IsLawBotRunning()) StopLawBot(); else { lawBotCrashCount = 0; StartLawBot(); }
                BuildMenu();
            };
            lawMenu.DropDownItems.Add(lawStartItem);
            lawMenu.DropDownItems.Add(L("lawbot_settings"), null, (s, e) => ShowLawBotEnvDialog());
            string lawLogPath = Path.Combine(lawBotDir, "law-bot.log");
            lawMenu.DropDownItems.Add(L("lawbot_log"), null, (s, e) => {
                if (File.Exists(lawLogPath)) Process.Start("notepad", lawLogPath);
            });
            menu.Items.Add(lawMenu);
        }

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(L("rebuild"), null, (s, e) => RebuildAndRestart());
        menu.Items.Add(L("restart"), null, (s, e) => RestartBot(botDir, botJsPath));
        menu.Items.Add(L("quit"), null, (s, e) => StopBot());

        trayIcon.ContextMenuStrip = menu;
    }

    static void SwitchLanguage(string lang)
    {
        if (lang == currentLang) return;
        currentLang = lang;
        WriteLangToState(lang);
        BuildMenu();
        RestartBot(botDir, botJsPath);
    }

    [STAThread]
    static void Main()
    {
        // 중복 실행 방지
        bool createdNew;
        appMutex = new System.Threading.Mutex(true, "ClaudeTelegramBot_SingleInstance", out createdNew);
        if (!createdNew)
        {
            MessageBox.Show(L("already_running"), "Claude Telegram Bot", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        botDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        botJsPath = Path.Combine(botDir, "bot.js");
        logPath = Path.Combine(botDir, "bot.log");
        botStatePath = Path.Combine(botDir, "bot-state.json");
        lawBotDir = Path.Combine(botDir, "law-bot");
        lawBotJsPath = Path.Combine(lawBotDir, "law-bot.js");

        // 언어 로드
        currentLang = ReadLangFromState();

        if (!File.Exists(botJsPath))
        {
            MessageBox.Show(string.Format(L("bot_not_found"), botJsPath),
                "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        ParseEnv(Path.Combine(botDir, ".env"));

        fullPath = GetFullPath();
        string nodePath = FindNodePath();
        if (nodePath == "node")
        {
            MessageBox.Show(L("node_not_found"),
                "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        botProcess = Process.Start(CreateNodeStartInfo(botJsPath, botDir));

        // Auto-start law-bot if enabled in settings
        lawBotAutoStart = ReadLawBotAutoStart();
        if (lawBotAutoStart && File.Exists(lawBotJsPath) && File.Exists(Path.Combine(lawBotDir, ".env")))
        {
            StartLawBot();
        }

        Application.EnableVisualStyles();

        string label = string.IsNullOrEmpty(computerName)
            ? "Claude Telegram Bot"
            : "Claude Telegram Bot [" + computerName + "]";

        trayIcon = new NotifyIcon();
        trayIcon.Text = label;
        trayIcon.Visible = true;
        trayIcon.Icon = Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location);

        BuildMenu();
        trayIcon.DoubleClick += (s, e) => OpenLog();

        ShowSplash();

        // Watch for bot crash or restart request (exit code 82)
        Timer timer = new Timer();
        timer.Interval = 2000;
        timer.Tick += (s, e) =>
        {
            if (botProcess != null && botProcess.HasExited)
            {
                if (botProcess.ExitCode == 82)
                {
                    RestartBot(botDir, botJsPath);
                }
                else if (botProcess.ExitCode == 2)
                {
                    // 설정 미비 (토큰 없음) — 최초 1회만 설정 UI
                    if (!setupNotified)
                    {
                        setupNotified = true;
                        ShowEnvSetupDialog();
                    }
                }
                else if (botProcess.ExitCode == 1)
                {
                    // lock 충돌 등 — 트레이 유지, 자동 재시작 시도
                    try { File.Delete(Path.Combine(botDir, "bot.lock")); } catch { }
                    RestartBot(botDir, botJsPath);
                }
                else
                {
                    StopBot();
                }
            }
            // Law bot crash watch — auto-restart (max 3 retries)
            if (lawBotProcess != null && lawBotProcess.HasExited && lawBotEnabled)
            {
                lawBotProcess = null;
                if (lawBotCrashCount >= 3)
                {
                    lawBotEnabled = false;
                    SendLawBotTelegram("⚠️ 법률 봇이 반복 오류로 중지되었습니다. 트레이에서 수동으로 시작해주세요.");
                    lawBotCrashCount = 0;
                }
                else
                {
                    lawBotCrashCount++;
                    StartLawBot(silent: true);
                }
            }
        };
        timer.Start();

        Application.Run();
    }

    static RichTextBox CreateGuideTab(string content, string[][] highlights)
    {
        RichTextBox rtb = new RichTextBox();
        rtb.ReadOnly = true;
        rtb.Dock = DockStyle.Fill;
        rtb.BackColor = Color.FromArgb(250, 250, 252);
        rtb.BorderStyle = BorderStyle.None;
        rtb.Font = new Font("Malgun Gothic", 9.8f);
        rtb.Text = content;
        rtb.Cursor = Cursors.Default;

        string text = rtb.Text;
        // bold highlights
        if (highlights != null)
        {
            foreach (string[] h in highlights)
            {
                int searchStart = 0;
                while (searchStart < text.Length)
                {
                    int idx = text.IndexOf(h[0], searchStart);
                    if (idx < 0) break;
                    rtb.Select(idx, h[0].Length);
                    rtb.SelectionFont = new Font("Malgun Gothic", 9.8f, FontStyle.Bold);
                    if (h.Length > 1 && h[1] != null)
                        rtb.SelectionColor = ColorTranslator.FromHtml(h[1]);
                    searchStart = idx + h[0].Length;
                }
            }
        }

        rtb.Select(0, 0);
        return rtb;
    }

    static void ShowGuide()
    {
        Form guide = new Form();
        guide.Text = L("guide_title");
        guide.Size = new Size(580, 620);
        guide.StartPosition = FormStartPosition.CenterScreen;
        guide.FormBorderStyle = FormBorderStyle.FixedDialog;
        guide.MaximizeBox = false;
        guide.MinimizeBox = false;
        guide.Font = new Font("Malgun Gothic", 9.5f);
        guide.BackColor = Color.White;

        // 헤더
        Label lblTitle = new Label {
            Text = "Claude Telegram Bot",
            Location = new Point(20, 15),
            AutoSize = true,
            Font = new Font("Malgun Gothic", 15f, FontStyle.Bold)
        };
        Label lblSub = new Label {
            Text = currentLang == "en"
                ? "Remote control Claude Code CLI via Telegram"
                : "텔레그램으로 Claude Code CLI를 원격 제어",
            Location = new Point(22, 48),
            AutoSize = true,
            ForeColor = Color.FromArgb(120, 120, 120)
        };
        guide.Controls.Add(lblTitle);
        guide.Controls.Add(lblSub);

        // 탭
        TabControl tabs = new TabControl();
        tabs.Location = new Point(10, 75);
        tabs.Size = new Size(545, 490);
        tabs.Font = new Font("Malgun Gothic", 9.5f);

        if (currentLang == "en")
        {
            // Quick Start
            tabs.TabPages.Add(CreateTabPage("Quick Start", CreateGuideTab(
                "  Getting Started\r\n" +
                "\r\n" +
                "  Before you begin, make sure you have:\r\n" +
                "    \u2022 Node.js 20+  (nodejs.org)\r\n" +
                "    \u2022 Claude Code CLI\r\n" +
                "      npm i -g @anthropic-ai/claude-code\r\n" +
                "    \u2022 Logged in to Claude Code (run 'claude' once)\r\n" +
                "\r\n\r\n" +
                "  Step 1  Create a Telegram Bot\r\n" +
                "\r\n" +
                "    1. Open Telegram, search @BotFather\r\n" +
                "    2. Send /newbot, follow the prompts\r\n" +
                "    3. Copy the bot token\r\n" +
                "\r\n\r\n" +
                "  Step 2  Configure Settings\r\n" +
                "\r\n" +
                "    1. Right-click tray icon \u2192 Settings\r\n" +
                "    2. Paste your Bot Token \u2192 Save\r\n" +
                "    3. In Telegram, send /start to your bot\r\n" +
                "    4. Copy the User ID shown in chat\r\n" +
                "    5. Right-click tray \u2192 Settings \u2192 paste User ID \u2192 Save\r\n" +
                "\r\n\r\n" +
                "  Step 3  Start Using\r\n" +
                "\r\n" +
                "    Send any message to your bot in Telegram.\r\n" +
                "    Claude Code will process it and reply.\r\n",
                new string[][] {
                    new string[] { "Getting Started", "#2563EB" },
                    new string[] { "Step 1  Create a Telegram Bot", "#2563EB" },
                    new string[] { "Step 2  Configure Settings", "#2563EB" },
                    new string[] { "Step 3  Start Using", "#2563EB" },
                    new string[] { "Before you begin", null }
                }
            )));

            // Commands
            tabs.TabPages.Add(CreateTabPage("Commands", CreateGuideTab(
                "  Telegram Commands\r\n" +
                "\r\n" +
                "  Session\r\n" +
                "    /start        Start bot + show User ID\r\n" +
                "    /new          New Claude session\r\n" +
                "    /resume       Resume a terminal session\r\n" +
                "    /cancel       Cancel current task\r\n" +
                "    /status       Session, directory, budget info\r\n" +
                "\r\n" +
                "  Files\r\n" +
                "    /setdir       Change working directory\r\n" +
                "    /files        List files in directory\r\n" +
                "    /read <file>  Read file contents\r\n" +
                "    /preview      Preview (HTML/image/script)\r\n" +
                "\r\n" +
                "  Settings\r\n" +
                "    /setbudget    Session cost cap (default $5)\r\n" +
                "    /effort       low | medium | high | max\r\n" +
                "    /lock <PIN>   Lock bot with PIN\r\n" +
                "    /unlock <PIN> Unlock bot\r\n" +
                "\r\n" +
                "  Network\r\n" +
                "    /tunnel       Tunnel management\r\n" +
                "    /restart      Restart the bot\r\n" +
                "    /plan         Enable plan mode\r\n",
                new string[][] {
                    new string[] { "Telegram Commands", "#2563EB" },
                    new string[] { "Session", null }, new string[] { "Files", null },
                    new string[] { "Settings", null }, new string[] { "Network", null }
                }
            )));

            // Features
            tabs.TabPages.Add(CreateTabPage("Features", CreateGuideTab(
                "  Key Features\r\n" +
                "\r\n" +
                "  Photo & File Upload\r\n" +
                "    \u2022 Photo with caption \u2192 sent to Claude immediately\r\n" +
                "    \u2022 Photo without caption \u2192 waits for your message\r\n" +
                "    \u2022 Documents (code, PDF) also supported\r\n" +
                "\r\n" +
                "  Permission Modes\r\n" +
                "    \u2022 Safe Mode: read-only auto, rest needs approval\r\n" +
                "    \u2022 Allow All: all tool uses auto-approved\r\n" +
                "\r\n" +
                "  Plan Mode  (/plan)\r\n" +
                "    \u2022 Claude creates a plan before executing\r\n" +
                "    \u2022 You approve/reject via Telegram buttons\r\n" +
                "\r\n" +
                "  Cost Control  (/setbudget)\r\n" +
                "    \u2022 Set max cost per session (default $5)\r\n" +
                "    \u2022 Session stops when budget is reached\r\n" +
                "\r\n" +
                "  Multiple PCs\r\n" +
                "    \u2022 Create a separate bot per computer\r\n" +
                "    \u2022 Set different COMPUTER_NAME in Settings\r\n" +
                "    \u2022 Each PC gets its own Telegram chat\r\n",
                new string[][] {
                    new string[] { "Key Features", "#2563EB" },
                    new string[] { "Photo & File Upload", null },
                    new string[] { "Permission Modes", null },
                    new string[] { "Plan Mode", null },
                    new string[] { "Cost Control", null },
                    new string[] { "Multiple PCs", null }
                }
            )));

            // Legal Bot
            tabs.TabPages.Add(CreateTabPage("Legal Bot", CreateGuideTab(
                "  Legal Bot  \u2696\uFE0F\r\n" +
                "\r\n" +
                "  A family-friendly legal assistant that searches\r\n" +
                "  Korean laws, precedents, and regulations via Telegram.\r\n" +
                "\r\n\r\n" +
                "  What it does\r\n" +
                "\r\n" +
                "    \u2022 Search Korean laws by keyword\r\n" +
                "    \u2022 Look up full law text by article\r\n" +
                "    \u2022 Search court precedents\r\n" +
                "    \u2022 Search administrative rules & local ordinances\r\n" +
                "    \u2022 Explains legal terms in everyday language\r\n" +
                "\r\n\r\n" +
                "  Setup  (one-time, ~5 min)\r\n" +
                "\r\n" +
                "    1. Create a NEW Telegram bot via @BotFather\r\n" +
                "       (separate from the remote-cli bot)\r\n" +
                "       \u2192 Copy the bot token\r\n" +
                "\r\n" +
                "    2. Get a free API key from open.law.go.kr\r\n" +
                "       \u2192 Sign up \u2192 My Page \u2192 Open API Key\r\n" +
                "\r\n" +
                "    3. Right-click tray \u2192 Legal Bot \u2192 Settings\r\n" +
                "       \u2192 Paste token + API key + family user IDs\r\n" +
                "\r\n" +
                "    4. Have each family member send /start\r\n" +
                "       to the legal bot in Telegram\r\n" +
                "\r\n\r\n" +
                "  How to use\r\n" +
                "\r\n" +
                "    Just ask a question in plain language:\r\n" +
                "    \u2022 \"What are tenant rights for deposit return?\"\r\n" +
                "    \u2022 \"Traffic accident compensation rules\"\r\n" +
                "    \u2022 \"Inheritance law for unmarried children\"\r\n" +
                "\r\n" +
                "    Quick categories: /start shows category buttons\r\n" +
                "    New conversation: /new\r\n",
                new string[][] {
                    new string[] { "Legal Bot  \u2696\uFE0F", "#7C3AED" },
                    new string[] { "What it does", "#7C3AED" },
                    new string[] { "Setup  (one-time, ~5 min)", "#7C3AED" },
                    new string[] { "How to use", "#7C3AED" },
                    new string[] { "Just ask a question", null }
                }
            )));

            // Troubleshooting
            tabs.TabPages.Add(CreateTabPage("Help", CreateGuideTab(
                "  Troubleshooting\r\n" +
                "\r\n" +
                "  Bot won't start\r\n" +
                "    \u2022 Check that Node.js is installed and in PATH\r\n" +
                "    \u2022 Check tray \u2192 View Log for errors\r\n" +
                "    \u2022 Make sure 'claude' CLI works in terminal\r\n" +
                "\r\n" +
                "  Bot starts but Telegram doesn't respond\r\n" +
                "    \u2022 Verify Bot Token is correct in Settings\r\n" +
                "    \u2022 Verify User ID is correct (send /start)\r\n" +
                "    \u2022 Check your internet connection\r\n" +
                "\r\n" +
                "  Claude errors or timeouts\r\n" +
                "    \u2022 Run 'claude' in terminal to verify login\r\n" +
                "    \u2022 Check if API subscription is active\r\n" +
                "    \u2022 Try /new to start a fresh session\r\n" +
                "\r\n" +
                "  After changing settings\r\n" +
                "    \u2022 Always restart via tray menu after changes\r\n" +
                "\r\n\r\n" +
                "  Tray Menu\r\n" +
                "\r\n" +
                "    \u2022 Guide: This window\r\n" +
                "    \u2022 View Log: Open bot.log\r\n" +
                "    \u2022 Settings: Configure bot token, user ID\r\n" +
                "    \u2022 Auto Start: Run on Windows startup\r\n" +
                "    \u2022 Rebuild: Recompile after code changes\r\n" +
                "    \u2022 Restart / Quit\r\n",
                new string[][] {
                    new string[] { "Troubleshooting", "#2563EB" },
                    new string[] { "Tray Menu", "#2563EB" },
                    new string[] { "Bot won't start", null },
                    new string[] { "Bot starts but Telegram doesn't respond", null },
                    new string[] { "Claude errors or timeouts", null },
                    new string[] { "After changing settings", null }
                }
            )));
        }
        else
        {
            // 빠른 시작
            tabs.TabPages.Add(CreateTabPage("\uC2DC\uC791\uD558\uAE30", CreateGuideTab(
                "  시작하기\r\n" +
                "\r\n" +
                "  사전 준비:\r\n" +
                "    \u2022 Node.js 20 이상  (nodejs.org)\r\n" +
                "    \u2022 Claude Code CLI 설치\r\n" +
                "      npm i -g @anthropic-ai/claude-code\r\n" +
                "    \u2022 Claude Code 로그인 완료 (터미널에서 claude 한번 실행)\r\n" +
                "\r\n\r\n" +
                "  1단계  텔레그램 봇 만들기\r\n" +
                "\r\n" +
                "    1. 텔레그램에서 @BotFather 검색\r\n" +
                "    2. /newbot 전송 후 안내에 따라 봇 생성\r\n" +
                "    3. 발급된 봇 토큰 복사\r\n" +
                "\r\n\r\n" +
                "  2단계  설정하기\r\n" +
                "\r\n" +
                "    1. 트레이 아이콘 우클릭 \u2192 설정\r\n" +
                "    2. Bot Token 붙여넣기 \u2192 저장\r\n" +
                "    3. 텔레그램에서 내 봇에게 /start 전송\r\n" +
                "    4. 채팅에 표시된 유저 ID 복사\r\n" +
                "    5. 트레이 우클릭 \u2192 설정 \u2192 유저 ID 붙여넣기 \u2192 저장\r\n" +
                "\r\n\r\n" +
                "  3단계  사용하기\r\n" +
                "\r\n" +
                "    텔레그램에서 봇에게 아무 메시지나 보내세요.\r\n" +
                "    Claude Code가 처리하고 답변합니다.\r\n",
                new string[][] {
                    new string[] { "\uC2DC\uC791\uD558\uAE30", "#2563EB" },
                    new string[] { "1\uB2E8\uACC4  \uD154\uB808\uADF8\uB7A8 \uBD07 \uB9CC\uB4E4\uAE30", "#2563EB" },
                    new string[] { "2\uB2E8\uACC4  \uC124\uC815\uD558\uAE30", "#2563EB" },
                    new string[] { "3\uB2E8\uACC4  \uC0AC\uC6A9\uD558\uAE30", "#2563EB" },
                    new string[] { "\uC0AC\uC804 \uC900\uBE44:", null }
                }
            )));

            // 명령어
            tabs.TabPages.Add(CreateTabPage("\uBA85\uB839\uC5B4", CreateGuideTab(
                "  텔레그램 명령어\r\n" +
                "\r\n" +
                "  세션\r\n" +
                "    /start        봇 시작 + 유저 ID 확인\r\n" +
                "    /new          새 Claude 세션 시작\r\n" +
                "    /resume       터미널 세션 이어받기\r\n" +
                "    /cancel       현재 작업 취소\r\n" +
                "    /status       세션, 디렉토리, 비용 정보\r\n" +
                "\r\n" +
                "  파일\r\n" +
                "    /setdir       작업 디렉토리 변경\r\n" +
                "    /files        파일 목록 보기\r\n" +
                "    /read <파일>  파일 내용 읽기\r\n" +
                "    /preview      미리보기 (HTML/이미지/스크립트)\r\n" +
                "\r\n" +
                "  설정\r\n" +
                "    /setbudget    세션 비용 상한 (기본 $5)\r\n" +
                "    /effort       low | medium | high | max\r\n" +
                "    /lock <PIN>   봇 잠금\r\n" +
                "    /unlock <PIN> 잠금 해제\r\n" +
                "\r\n" +
                "  기타\r\n" +
                "    /tunnel       터널 관리\r\n" +
                "    /restart      봇 재시작\r\n" +
                "    /plan         플랜 모드 활성화\r\n",
                new string[][] {
                    new string[] { "\uD154\uB808\uADF8\uB7A8 \uBA85\uB839\uC5B4", "#2563EB" },
                    new string[] { "\uC138\uC158", null }, new string[] { "\uD30C\uC77C", null },
                    new string[] { "\uC124\uC815", null }, new string[] { "\uAE30\uD0C0", null }
                }
            )));

            // 기능
            tabs.TabPages.Add(CreateTabPage("\uAE30\uB2A5", CreateGuideTab(
                "  주요 기능\r\n" +
                "\r\n" +
                "  사진/파일 전송\r\n" +
                "    \u2022 사진 + 캡션 \u2192 Claude에 바로 전달\r\n" +
                "    \u2022 사진만 전송 \u2192 후속 메시지 대기\r\n" +
                "    \u2022 문서 (코드, PDF 등) 지원\r\n" +
                "\r\n" +
                "  권한 모드\r\n" +
                "    \u2022 안전 모드: 읽기만 자동 허용, 나머지 승인 필요\r\n" +
                "    \u2022 전체 허용: 모든 도구 사용 자동 승인\r\n" +
                "\r\n" +
                "  플랜 모드  (/plan)\r\n" +
                "    \u2022 Claude가 실행 전 계획을 먼저 작성\r\n" +
                "    \u2022 텔레그램 버튼으로 승인/거부\r\n" +
                "\r\n" +
                "  비용 제어  (/setbudget)\r\n" +
                "    \u2022 세션당 최대 비용 설정 (기본 $5)\r\n" +
                "    \u2022 상한 도달 시 세션 자동 종료\r\n" +
                "\r\n" +
                "  여러 컴퓨터 사용\r\n" +
                "    \u2022 컴퓨터마다 별도 봇 생성\r\n" +
                "    \u2022 설정에서 다른 Computer Name 지정\r\n" +
                "    \u2022 각 PC별 텔레그램 채팅방 사용\r\n",
                new string[][] {
                    new string[] { "\uC8FC\uC694 \uAE30\uB2A5", "#2563EB" },
                    new string[] { "\uC0AC\uC9C4/\uD30C\uC77C \uC804\uC1A1", null },
                    new string[] { "\uAD8C\uD55C \uBAA8\uB4DC", null },
                    new string[] { "\uD50C\uB79C \uBAA8\uB4DC", null },
                    new string[] { "\uBE44\uC6A9 \uC81C\uC5B4", null },
                    new string[] { "\uC5EC\uB7EC \uCEF4\uD4E8\uD130 \uC0AC\uC6A9", null }
                }
            )));

            // 법률 봇
            tabs.TabPages.Add(CreateTabPage("\uBC95\uB960 \uBD07", CreateGuideTab(
                "  법률 봇  \u2696\uFE0F\r\n" +
                "\r\n" +
                "  가족 모두가 쓸 수 있는 법률 도우미입니다.\r\n" +
                "  한국 법령, 판례, 행정규칙을 텔레그램으로 쉽게 검색해요.\r\n" +
                "\r\n\r\n" +
                "  이런 걸 할 수 있어요\r\n" +
                "\r\n" +
                "    \u2022 법령 키워드 검색 (예: 주택임대차보호법)\r\n" +
                "    \u2022 법령 조문 전체 조회\r\n" +
                "    \u2022 판례 검색 (예: 보증금 반환 판례)\r\n" +
                "    \u2022 행정규칙, 지방 조례 검색\r\n" +
                "    \u2022 어려운 법률 용어를 쉬운 말로 설명\r\n" +
                "\r\n\r\n" +
                "  설정 방법  (처음 한 번, 약 5분)\r\n" +
                "\r\n" +
                "    1. @BotFather에서 새 봇을 만드세요\r\n" +
                "       (원격 제어 봇과 별도로 만들어야 해요)\r\n" +
                "       \u2192 발급된 봇 토큰 복사\r\n" +
                "\r\n" +
                "    2. open.law.go.kr에서 무료 API 키 발급\r\n" +
                "       \u2192 회원가입 \u2192 마이페이지 \u2192 오픈 API 키\r\n" +
                "\r\n" +
                "    3. 트레이 우클릭 \u2192 법률 봇 \u2192 설정\r\n" +
                "       \u2192 토큰 + API 키 + 가족 유저 ID 입력\r\n" +
                "\r\n" +
                "    4. 가족 각자가 법률 봇에게 /start 전송\r\n" +
                "\r\n\r\n" +
                "  사용 방법\r\n" +
                "\r\n" +
                "    궁금한 걸 편하게 물어보세요:\r\n" +
                "    \u2022 \"전세 보증금 못 돌려받으면 어떻게 해?\"\r\n" +
                "    \u2022 \"교통사고 합의금 기준이 뭐야?\"\r\n" +
                "    \u2022 \"미혼 자녀 상속 비율 알려줘\"\r\n" +
                "\r\n" +
                "    빠른 분야 선택: /start 하면 버튼이 나와요\r\n" +
                "    새 대화 시작: /new\r\n",
                new string[][] {
                    new string[] { "\uBC95\uB960 \uBD07  \u2696\uFE0F", "#7C3AED" },
                    new string[] { "\uC774\uB7F0 \uAC78 \uD560 \uC218 \uC788\uC5B4\uC694", "#7C3AED" },
                    new string[] { "\uC124\uC815 \uBC29\uBC95  (\uCC98\uC74C \uD55C \uBC88, \uC57D 5\uBD84)", "#7C3AED" },
                    new string[] { "\uC0AC\uC6A9 \uBC29\uBC95", "#7C3AED" },
                    new string[] { "\uAD81\uAE08\uD55C \uAC78 \uD3B8\uD558\uAC8C \uBB3C\uC5B4\uBCF4\uC138\uC694", null }
                }
            )));

            // 문제 해결
            tabs.TabPages.Add(CreateTabPage("\uBB38\uC81C\uD574\uACB0", CreateGuideTab(
                "  문제 해결\r\n" +
                "\r\n" +
                "  봇이 안 켜져요\r\n" +
                "    \u2022 Node.js가 설치되어 있고 PATH에 있는지 확인\r\n" +
                "    \u2022 트레이 \u2192 로그 보기에서 오류 확인\r\n" +
                "    \u2022 터미널에서 'claude' 명령이 되는지 확인\r\n" +
                "\r\n" +
                "  봇은 켜졌는데 텔레그램이 응답 없어요\r\n" +
                "    \u2022 설정에서 Bot Token이 맞는지 확인\r\n" +
                "    \u2022 유저 ID가 맞는지 확인 (/start 다시 전송)\r\n" +
                "    \u2022 인터넷 연결 확인\r\n" +
                "\r\n" +
                "  Claude 오류/타임아웃\r\n" +
                "    \u2022 터미널에서 'claude' 실행해 로그인 확인\r\n" +
                "    \u2022 API 구독이 활성 상태인지 확인\r\n" +
                "    \u2022 /new로 새 세션 시작해 보기\r\n" +
                "\r\n" +
                "  설정 변경 후\r\n" +
                "    \u2022 반드시 트레이 메뉴에서 재시작\r\n" +
                "\r\n\r\n" +
                "  트레이 메뉴\r\n" +
                "\r\n" +
                "    \u2022 설명서: 이 화면\r\n" +
                "    \u2022 로그 보기: bot.log 열기\r\n" +
                "    \u2022 설정: 봇 토큰, 유저 ID 설정\r\n" +
                "    \u2022 자동 실행: 윈도우 부팅 시 자동 시작\r\n" +
                "    \u2022 재빌드: 코드 수정 후 재컴파일\r\n" +
                "    \u2022 재시작 / 종료\r\n",
                new string[][] {
                    new string[] { "\uBB38\uC81C \uD574\uACB0", "#2563EB" },
                    new string[] { "\uD2B8\uB808\uC774 \uBA54\uB274", "#2563EB" },
                    new string[] { "\uBD07\uC774 \uC548 \uCF1C\uC838\uC694", null },
                    new string[] { "\uBD07\uC740 \uCF1C\uC84C\uB294\uB370 \uD154\uB808\uADF8\uB7A8\uC774 \uC751\uB2F5 \uC5C6\uC5B4\uC694", null },
                    new string[] { "Claude \uC624\uB958/\uD0C0\uC784\uC544\uC6C3", null },
                    new string[] { "\uC124\uC815 \uBCC0\uACBD \uD6C4", null }
                }
            )));
        }

        guide.Controls.Add(tabs);
        guide.Show();
    }

    static TabPage CreateTabPage(string title, Control content)
    {
        TabPage page = new TabPage(title);
        page.BackColor = Color.White;
        page.Padding = new Padding(8);
        content.Dock = DockStyle.Fill;
        page.Controls.Add(content);
        return page;
    }


    static void OpenLog()
    {
        if (File.Exists(logPath))
            Process.Start("notepad", logPath);
    }

    static void ShowEnvSetupDialog()
    {
        string envPath = Path.Combine(botDir, ".env");

        // 기존 .env 값 읽기
        string existingToken = "";
        string existingUserId = "";
        string existingName = "";
        string existingOpenAI = "";
        if (File.Exists(envPath))
        {
            foreach (string line in File.ReadAllLines(envPath))
            {
                string trimmed = line.Trim();
                if (trimmed.StartsWith("#")) continue;
                int eq = trimmed.IndexOf('=');
                if (eq < 0) continue;
                string key = trimmed.Substring(0, eq).Trim();
                string val = trimmed.Substring(eq + 1).Trim();
                if (key == "TELEGRAM_BOT_TOKEN") existingToken = val;
                if (key == "AUTHORIZED_USER_ID") existingUserId = val;
                if (key == "COMPUTER_NAME") existingName = val;
                if (key == "OPENAI_API_KEY") existingOpenAI = val;
            }
        }

        Form form = new Form();
        form.Text = "Claude Telegram Bot — " + L("env_setup_title");
        form.Size = new Size(520, 620);
        form.StartPosition = FormStartPosition.CenterScreen;
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.MinimizeBox = false;
        form.Font = new Font("Malgun Gothic", 9.5f);

        int pad = 20;
        int inputW = 450;
        int y = pad;

        // ─── 가이드 헤더 ───
        Label lblTitle = new Label {
            Text = "Claude Telegram Bot",
            Location = new Point(pad, y),
            AutoSize = true,
            Font = new Font("Malgun Gothic", 14f, FontStyle.Bold)
        };
        y += 35;

        Label lblGuide = new Label {
            Text = L("env_guide"),
            Location = new Point(pad, y),
            Size = new Size(inputW, 100),
            ForeColor = Color.FromArgb(80, 80, 80),
            Font = new Font("Malgun Gothic", 8.8f)
        };
        y += 105;

        // ─── 구분선 ───
        Label separator = new Label {
            Location = new Point(pad, y),
            Size = new Size(inputW, 1),
            BorderStyle = BorderStyle.Fixed3D
        };
        y += 15;

        // ─── Bot Token ───
        Label lblToken = new Label { Text = "Telegram Bot Token *", Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtToken = new TextBox { Location = new Point(pad, y), Width = inputW, Text = existingToken };
        y += 30;
        Label lblTokenHint = new Label { Text = L("env_token_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 25;

        // ─── User ID ───
        Label lblUser = new Label { Text = "Authorized User ID", Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtUser = new TextBox { Location = new Point(pad, y), Width = inputW, Text = existingUserId };
        y += 30;
        Label lblUserHint = new Label { Text = L("env_userid_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 25;

        // ─── Computer Name ───
        Label lblName = new Label { Text = "Computer Name", Location = new Point(pad, y), AutoSize = true };
        y += 22;
        TextBox txtName = new TextBox { Location = new Point(pad, y), Width = inputW, Text = string.IsNullOrEmpty(existingName) ? Environment.MachineName : existingName };
        y += 30;
        Label lblNameHint = new Label { Text = L("env_name_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 25;

        // ─── OpenAI API Key ───
        Label lblOpenAI = new Label { Text = "OpenAI API Key", Location = new Point(pad, y), AutoSize = true };
        y += 22;
        TextBox txtOpenAI = new TextBox { Location = new Point(pad, y), Width = inputW, Text = existingOpenAI };
        y += 30;
        Label lblOpenAIHint = new Label { Text = L("env_openai_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 40;

        // ─── 버튼 ───
        Button btnSave = new Button { Text = L("env_save"), Location = new Point(pad, y), Width = 160, Height = 38 };
        btnSave.BackColor = Color.FromArgb(59, 130, 246);
        btnSave.ForeColor = Color.White;
        btnSave.FlatStyle = FlatStyle.Flat;
        btnSave.Font = new Font("Malgun Gothic", 10f, FontStyle.Bold);
        Button btnCancel = new Button { Text = L("env_cancel"), Location = new Point(pad + 170, y), Width = 100, Height = 38 };
        btnCancel.FlatStyle = FlatStyle.Flat;

        btnSave.Click += (s, e) =>
        {
            if (string.IsNullOrWhiteSpace(txtToken.Text))
            {
                MessageBox.Show(L("env_token_required"), "Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("# Telegram Bot Token (BotFather)");
            sb.AppendLine("TELEGRAM_BOT_TOKEN=" + txtToken.Text.Trim());
            sb.AppendLine();
            sb.AppendLine("# Authorized Telegram User ID");
            sb.AppendLine("AUTHORIZED_USER_ID=" + txtUser.Text.Trim());
            sb.AppendLine();
            sb.AppendLine("# Computer Name");
            sb.AppendLine("COMPUTER_NAME=" + (string.IsNullOrWhiteSpace(txtName.Text) ? Environment.MachineName : txtName.Text.Trim()));
            if (!string.IsNullOrWhiteSpace(txtOpenAI.Text))
            {
                sb.AppendLine();
                sb.AppendLine("# OpenAI API Key (Voice)");
                sb.AppendLine("OPENAI_API_KEY=" + txtOpenAI.Text.Trim());
            }
            File.WriteAllText(envPath, sb.ToString(), Encoding.UTF8);
            btnSave.Text = L("env_saved");
            btnSave.BackColor = Color.FromArgb(34, 197, 94);
            Timer resetTimer = new Timer { Interval = 2000 };
            resetTimer.Tick += (s2, e2) => {
                btnSave.Text = L("env_save");
                btnSave.BackColor = Color.FromArgb(59, 130, 246);
                resetTimer.Stop();
                resetTimer.Dispose();
            };
            resetTimer.Start();
            RestartBot(botDir, botJsPath);
        };

        btnCancel.Click += (s, e) => form.Close();

        form.Controls.AddRange(new Control[] {
            lblTitle, lblGuide, separator,
            lblToken, txtToken, lblTokenHint,
            lblUser, txtUser, lblUserHint,
            lblName, txtName, lblNameHint,
            lblOpenAI, txtOpenAI, lblOpenAIHint,
            btnSave, btnCancel
        });
        form.AcceptButton = btnSave;
        form.CancelButton = btnCancel;
        form.ShowDialog();
    }

    // ─── Law Bot Process Management ─────────────────────────────
    static bool IsLawBotRunning()
    {
        return lawBotProcess != null && !lawBotProcess.HasExited;
    }

    static void StartLawBot(bool silent = false)
    {
        if (IsLawBotRunning()) return;
        if (!File.Exists(lawBotJsPath)) return;

        string lawEnvPath = Path.Combine(lawBotDir, ".env");
        if (!File.Exists(lawEnvPath))
        {
            MessageBox.Show(L("lawbot_not_configured"), L("lawbot"), MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        // npm install if node_modules missing
        if (!Directory.Exists(Path.Combine(lawBotDir, "node_modules")))
        {
            try
            {
                ProcessStartInfo npmPsi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c npm install --production",
                    WorkingDirectory = lawBotDir,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                npmPsi.EnvironmentVariables["PATH"] = fullPath;
                Process npmProc = Process.Start(npmPsi);
                npmProc.WaitForExit(60000);
            }
            catch { }
        }

        try
        {
            ProcessStartInfo psi = CreateNodeStartInfo(lawBotJsPath, lawBotDir);
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            lawBotProcess = Process.Start(psi);

            // stdout/stderr → law-bot.log
            string logPath = Path.Combine(lawBotDir, "law-bot.log");
            System.Threading.ThreadPool.QueueUserWorkItem(_ => {
                try {
                    using (StreamWriter sw = new StreamWriter(logPath, false, Encoding.UTF8))
                    {
                        sw.AutoFlush = true;
                        sw.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] law-bot started");
                        while (lawBotProcess != null && !lawBotProcess.HasExited)
                        {
                            string line = lawBotProcess.StandardOutput.ReadLine();
                            if (line != null) sw.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + line);
                        }
                    }
                } catch { }
            });
            System.Threading.ThreadPool.QueueUserWorkItem(_ => {
                try {
                    using (StreamWriter sw = new StreamWriter(logPath, true, Encoding.UTF8))
                    {
                        sw.AutoFlush = true;
                        while (lawBotProcess != null && !lawBotProcess.HasExited)
                        {
                            string line = lawBotProcess.StandardError.ReadLine();
                            if (line != null) sw.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] ERR: " + line);
                        }
                    }
                } catch { }
            });

            lawBotEnabled = true;
            lawBotLastStart = DateTime.Now;
            if (!silent) SendLawBotTelegram("🟢 법률 도우미 봇이 시작되었습니다. 질문을 보내주세요!");
        }
        catch { lawBotEnabled = false; }
    }

    static void StopLawBot(bool silent = false)
    {
        lawBotEnabled = false;
        if (!silent)
        {
            SendLawBotTelegram("🔴 법률 도우미 봇이 종료되었습니다.");
            SendLawBotToUsers("🔧 법률 도우미 봇이 잠시 점검 중입니다.\n곧 다시 시작될 예정이니 잠시 후 다시 질문해주세요.");
        }
        try
        {
            if (lawBotProcess != null && !lawBotProcess.HasExited)
            {
                lawBotProcess.Kill();
                lawBotProcess.WaitForExit(3000);
            }
        }
        catch { }
        // Kill 후 lock 파일 삭제 (재시작 시 lock 충돌 방지)
        try { File.Delete(Path.Combine(lawBotDir, "law-bot.lock")); } catch { }
    }

    static void SendLawBotToUsers(string text)
    {
        if (lawBotDir == null) return;
        string lawEnvPath = Path.Combine(lawBotDir, ".env");
        if (!File.Exists(lawEnvPath)) return;
        string lawToken = "";
        string lawUsers = "";
        foreach (string line in File.ReadAllLines(lawEnvPath))
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith("#")) continue;
            int eq = trimmed.IndexOf('=');
            if (eq < 0) continue;
            string key = trimmed.Substring(0, eq).Trim();
            string val = trimmed.Substring(eq + 1).Trim();
            if (key == "TELEGRAM_BOT_TOKEN") lawToken = val;
            if (key == "AUTHORIZED_USERS") lawUsers = val;
        }
        if (string.IsNullOrEmpty(lawToken) || string.IsNullOrEmpty(lawUsers)) return;
        string[] allUsers = lawUsers.Split(',');
        // 첫 번째(관리자) 제외, 나머지 사용자에게만
        for (int i = 1; i < allUsers.Length; i++)
        {
            string id = allUsers[i].Trim();
            if (id.Length == 0) continue;
            try
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(
                    "https://api.telegram.org/bot" + lawToken + "/sendMessage");
                req.Method = "POST";
                req.ContentType = "application/json; charset=utf-8";
                req.Timeout = 5000;
                byte[] data = Encoding.UTF8.GetBytes(
                    "{\"chat_id\":\"" + id + "\",\"text\":\"" + text + "\"}");
                req.ContentLength = data.Length;
                using (Stream s = req.GetRequestStream()) { s.Write(data, 0, data.Length); }
                using (req.GetResponse()) { }
            }
            catch { }
        }
    }

    static void SendLawBotTelegram(string text)
    {
        if (lawBotDir == null) return;
        string lawEnvPath = Path.Combine(lawBotDir, ".env");
        if (!File.Exists(lawEnvPath)) return;
        string lawToken = "";
        string lawUsers = "";
        foreach (string line in File.ReadAllLines(lawEnvPath))
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith("#")) continue;
            int eq = trimmed.IndexOf('=');
            if (eq < 0) continue;
            string key = trimmed.Substring(0, eq).Trim();
            string val = trimmed.Substring(eq + 1).Trim();
            if (key == "TELEGRAM_BOT_TOKEN") lawToken = val;
            if (key == "AUTHORIZED_USERS") lawUsers = val;
        }
        if (string.IsNullOrEmpty(lawToken) || string.IsNullOrEmpty(lawUsers)) return;
        // 관리자(첫 번째 ID)에게만 시작/종료 알림
        string adminId = lawUsers.Split(',')[0].Trim();
        if (adminId.Length == 0) return;
        string[] targets = new string[] { adminId };
        foreach (string id in targets)
        {
            try
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(
                    "https://api.telegram.org/bot" + lawToken + "/sendMessage");
                req.Method = "POST";
                req.ContentType = "application/json; charset=utf-8";
                req.Timeout = 5000;  // 5초 타임아웃
                byte[] data = Encoding.UTF8.GetBytes(
                    "{\"chat_id\":\"" + id + "\",\"text\":\"" + text + "\"}");
                req.ContentLength = data.Length;
                using (Stream s = req.GetRequestStream()) { s.Write(data, 0, data.Length); }
                using (req.GetResponse()) { }
            }
            catch { }
        }
    }

    static void ShowLawBotEnvDialog()
    {
        string envPath = Path.Combine(lawBotDir, ".env");

        string existingToken = "";
        string existingOC = "";
        string existingUsers = "";
        if (File.Exists(envPath))
        {
            foreach (string line in File.ReadAllLines(envPath))
            {
                string trimmed = line.Trim();
                if (trimmed.StartsWith("#")) continue;
                int eq = trimmed.IndexOf('=');
                if (eq < 0) continue;
                string key = trimmed.Substring(0, eq).Trim();
                string val = trimmed.Substring(eq + 1).Trim();
                if (key == "TELEGRAM_BOT_TOKEN") existingToken = val;
                if (key == "LAW_OC") existingOC = val;
                if (key == "AUTHORIZED_USERS") existingUsers = val;
            }
        }

        // 첫 번째 = 관리자, 나머지 = 사용자
        string[] userList = existingUsers.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
        string existingAdmin = userList.Length > 0 ? userList[0].Trim() : "";
        System.Collections.Generic.List<string> existingMembers = new System.Collections.Generic.List<string>();
        for (int i = 1; i < userList.Length; i++)
        {
            string u = userList[i].Trim();
            if (u.Length > 0) existingMembers.Add(u);
        }

        Form form = new Form();
        form.Text = L("lawbot") + " \u2014 " + L("lawbot_env_title");
        form.Size = new Size(520, 780);
        form.StartPosition = FormStartPosition.CenterScreen;
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.MinimizeBox = false;
        form.Font = new Font("Malgun Gothic", 9.5f);

        int pad = 20;
        int inputW = 450;
        int y = pad;

        Label lblTitle = new Label {
            Text = L("lawbot") + " \u2696\uFE0F",
            Location = new Point(pad, y),
            AutoSize = true,
            Font = new Font("Malgun Gothic", 14f, FontStyle.Bold)
        };
        y += 35;

        Label lblGuide = new Label {
            Text = L("lawbot_env_guide"),
            Location = new Point(pad, y),
            Size = new Size(inputW, 160),
            ForeColor = Color.FromArgb(80, 80, 80),
            Font = new Font("Malgun Gothic", 8.8f)
        };
        y += 165;

        Label separator = new Label {
            Location = new Point(pad, y),
            Size = new Size(inputW, 1),
            BorderStyle = BorderStyle.Fixed3D
        };
        y += 15;

        // Telegram Bot Token
        Label lblToken = new Label { Text = "Telegram Bot Token *", Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtToken = new TextBox { Location = new Point(pad, y), Width = inputW, Text = existingToken };
        y += 30;
        Label lblTokenHint = new Label { Text = L("lawbot_token_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 25;

        // Law API Key (OC)
        Label lblOC = new Label { Text = "Law API Key (OC) *", Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtOC = new TextBox { Location = new Point(pad, y), Width = inputW, Text = existingOC };
        y += 30;
        Label lblOCHint = new Label { Text = L("lawbot_oc_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 30;

        // ─── 관리자 / 사용자 분리 ───
        Label sep2 = new Label {
            Location = new Point(pad, y),
            Size = new Size(inputW, 1),
            BorderStyle = BorderStyle.Fixed3D
        };
        y += 15;

        // 관리자 ID
        string adminLabel = currentLang == "en" ? "\uD83D\uDC51 Admin ID *" : "\uD83D\uDC51 \uAD00\uB9AC\uC790 ID *";
        Label lblAdmin = new Label { Text = adminLabel, Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtAdmin = new TextBox { Location = new Point(pad, y), Width = inputW, Text = existingAdmin };
        y += 30;
        string adminHint = currentLang == "en"
            ? "Your Telegram User ID (send /start to bot to find it)"
            : "\uBCF8\uC778\uC758 \uD154\uB808\uADF8\uB7A8 \uC720\uC800 ID (\uBD07\uC5D0 /start \uBCF4\uB0B4\uBA74 \uD655\uC778)";
        Label lblAdminHint = new Label { Text = adminHint, Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 25;

        // 사용자 목록 (read-only, 승인으로 자동 추가됨)
        string usersLabel = currentLang == "en" ? "\uD83D\uDC65 Users" : "\uD83D\uDC65 \uC0AC\uC6A9\uC790 \uBAA9\uB85D";
        Label lblUsers = new Label { Text = usersLabel, Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtUsers = new TextBox {
            Location = new Point(pad, y), Width = inputW,
            Text = string.Join(", ", existingMembers),
            BackColor = Color.FromArgb(245, 245, 248)
        };
        y += 30;
        string usersHint = currentLang == "en"
            ? "Auto-added when you approve via Telegram. Or enter manually (comma separated)"
            : "\uD154\uB808\uADF8\uB7A8\uC5D0\uC11C \uC2B9\uC778\uD558\uBA74 \uC790\uB3D9 \uCD94\uAC00. \uC9C1\uC811 \uC785\uB825\uB3C4 \uAC00\uB2A5 (\uC274\uD45C \uAD6C\uBD84)";
        Label lblUsersHint = new Label { Text = usersHint, Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 30;

        // 자동 시작 체크박스
        Label sep3 = new Label {
            Location = new Point(pad, y),
            Size = new Size(inputW, 1),
            BorderStyle = BorderStyle.Fixed3D
        };
        y += 15;
        string autoStartLabel = currentLang == "en"
            ? "Auto-start law bot when tray starts"
            : "트레이 시작 시 법률봇 자동 시작";
        CheckBox chkAutoStart = new CheckBox {
            Text = autoStartLabel,
            Location = new Point(pad, y),
            AutoSize = true,
            Checked = lawBotAutoStart,
            Font = new Font("Malgun Gothic", 9.5f)
        };
        y += 25;
        string autoStartHint = currentLang == "en"
            ? "Enable only on the computer where law bot should run (avoid duplicates)"
            : "법률봇을 실행할 컴퓨터에서만 켜세요 (중복 실행 방지)";
        Label lblAutoHint = new Label { Text = autoStartHint, Location = new Point(pad, y), Size = new Size(inputW, 30), ForeColor = Color.FromArgb(200, 80, 80), Font = new Font("Malgun Gothic", 8f) };
        y += 35;

        // Buttons
        Button btnSave = new Button { Text = L("env_save"), Location = new Point(pad, y), Width = 160, Height = 38 };
        btnSave.BackColor = Color.FromArgb(124, 58, 237);
        btnSave.ForeColor = Color.White;
        btnSave.FlatStyle = FlatStyle.Flat;
        btnSave.Font = new Font("Malgun Gothic", 10f, FontStyle.Bold);
        Button btnCancel = new Button { Text = L("env_cancel"), Location = new Point(pad + 170, y), Width = 100, Height = 38 };
        btnCancel.FlatStyle = FlatStyle.Flat;

        btnSave.Click += (s, e) =>
        {
            if (string.IsNullOrWhiteSpace(txtToken.Text))
            {
                MessageBox.Show(L("lawbot_token_required"), "Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (string.IsNullOrWhiteSpace(txtOC.Text))
            {
                MessageBox.Show(L("lawbot_oc_required"), "Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            // 관리자 + 사용자 합쳐서 AUTHORIZED_USERS로 저장
            string admin = txtAdmin.Text.Trim();
            string members = txtUsers.Text.Trim();
            string combined = admin;
            if (members.Length > 0) combined += "," + members;

            StringBuilder sb = new StringBuilder();
            sb.AppendLine("# Telegram Bot Token (BotFather - law bot)");
            sb.AppendLine("TELEGRAM_BOT_TOKEN=" + txtToken.Text.Trim());
            sb.AppendLine();
            sb.AppendLine("# Law API Key (open.law.go.kr)");
            sb.AppendLine("LAW_OC=" + txtOC.Text.Trim());
            sb.AppendLine();
            sb.AppendLine("# Authorized User IDs (first = admin, rest = users)");
            sb.AppendLine("AUTHORIZED_USERS=" + combined);
            sb.AppendLine();
            sb.AppendLine("# Language");
            sb.AppendLine("LANG=ko");

            File.WriteAllText(envPath, sb.ToString(), Encoding.UTF8);
            btnSave.Text = L("env_saved");
            btnSave.BackColor = Color.FromArgb(34, 197, 94);
            Timer resetTimer = new Timer { Interval = 2000 };
            resetTimer.Tick += (s2, e2) => {
                btnSave.Text = L("env_save");
                btnSave.BackColor = Color.FromArgb(124, 58, 237);
                resetTimer.Stop();
                resetTimer.Dispose();
            };
            resetTimer.Start();

            // 자동 시작 설정 저장
            lawBotAutoStart = chkAutoStart.Checked;
            WriteLawBotAutoStart(lawBotAutoStart);

            // Restart law bot
            StopLawBot();
            StartLawBot();
            BuildMenu();
        };

        btnCancel.Click += (s, e) => form.Close();

        form.Controls.AddRange(new Control[] {
            lblTitle, lblGuide, separator,
            lblToken, txtToken, lblTokenHint,
            lblOC, txtOC, lblOCHint,
            sep2,
            lblAdmin, txtAdmin, lblAdminHint,
            lblUsers, txtUsers, lblUsersHint,
            sep3, chkAutoStart, lblAutoHint,
            btnSave, btnCancel
        });
        form.AcceptButton = btnSave;
        form.CancelButton = btnCancel;
        form.ShowDialog();
    }

    // ─── Splash Screen (Fade In → Hold → Fade Out) ─────────────
    static void ShowSplash()
    {
        Form splash = new Form();
        splash.FormBorderStyle = FormBorderStyle.None;
        splash.StartPosition = FormStartPosition.CenterScreen;
        splash.Size = new Size(370, 200);
        splash.BackColor = Color.FromArgb(15, 15, 25);
        splash.ShowInTaskbar = false;
        splash.TopMost = true;
        splash.Opacity = 0;

        // rounded corners
        System.Drawing.Drawing2D.GraphicsPath path = new System.Drawing.Drawing2D.GraphicsPath();
        path.AddArc(0, 0, 20, 20, 180, 90);
        path.AddArc(splash.Width - 20, 0, 20, 20, 270, 90);
        path.AddArc(splash.Width - 20, splash.Height - 20, 20, 20, 0, 90);
        path.AddArc(0, splash.Height - 20, 20, 20, 90, 90);
        path.CloseFigure();
        splash.Region = new Region(path);

        // icon emoji
        Label lblIcon = new Label {
            Text = "\uD83E\uDD16",
            Font = new Font("Segoe UI Emoji", 32f),
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            AutoSize = true,
            Location = new Point(155, 22)
        };

        // title
        Label lblName = new Label {
            Text = "Claude Telegram Bot",
            Font = new Font("Segoe UI", 14f, FontStyle.Bold),
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            AutoSize = true
        };
        lblName.Location = new Point((370 - lblName.PreferredWidth) / 2, 85);

        // subtitle — "시작하는 중..." then switches to tray guide
        string subStart = currentLang == "en" ? "Starting..." : "\uC2DC\uC791\uD558\uB294 \uC911...";
        string subGuide = currentLang == "en"
            ? "\u2B07 Right-click the tray icon for menu"
            : "\u2B07 \uD2B8\uB808\uC774 \uC544\uC774\uCF58\uC744 \uC6B0\uD074\uB9AD\uD558\uC138\uC694";
        Label lblSub = new Label {
            Text = subStart,
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(160, 160, 180),
            BackColor = Color.Transparent,
            AutoSize = true
        };
        lblSub.Location = new Point((370 - lblSub.PreferredWidth) / 2, 118);

        // law-bot indicator
        bool lawBotActive = File.Exists(lawBotJsPath) && File.Exists(Path.Combine(lawBotDir, ".env"));
        if (lawBotActive)
        {
            string lawLabel = currentLang == "en" ? "\u2696\uFE0F Legal Bot ready" : "\u2696\uFE0F \uBC95\uB960 \uBD07 \uC900\uBE44 \uC644\uB8CC";
            Label lblLaw = new Label {
                Text = lawLabel,
                Font = new Font("Segoe UI", 8.5f),
                ForeColor = Color.FromArgb(124, 58, 237),
                BackColor = Color.Transparent,
                AutoSize = true
            };
            lblLaw.Location = new Point((370 - lblLaw.PreferredWidth) / 2, 148);
            splash.Controls.Add(lblLaw);
        }

        splash.Controls.Add(lblIcon);
        splash.Controls.Add(lblName);
        splash.Controls.Add(lblSub);
        splash.Show();

        // animation: fade in → hold (switch text) → fade out
        int phase = 0;        // 0=fadeIn, 1=hold, 2=fadeOut
        int holdTicks = 0;
        bool textSwitched = false;
        Timer anim = new Timer();
        anim.Interval = 30;
        anim.Tick += (s, e) =>
        {
            if (phase == 0)
            {
                splash.Opacity += 0.06;
                if (splash.Opacity >= 1.0) { splash.Opacity = 1.0; phase = 1; }
            }
            else if (phase == 1)
            {
                holdTicks++;
                // at ~1s, switch subtitle to tray guide
                if (holdTicks > 33 && !textSwitched)
                {
                    textSwitched = true;
                    lblSub.Text = subGuide;
                    lblSub.ForeColor = Color.FromArgb(100, 180, 255);
                    lblSub.Location = new Point((370 - lblSub.PreferredWidth) / 2, 118);
                }
                if (holdTicks > 100) phase = 2;   // ~3s total hold (guide visible ~2s)
            }
            else
            {
                splash.Opacity -= 0.04;
                if (splash.Opacity <= 0)
                {
                    anim.Stop();
                    anim.Dispose();
                    splash.Close();
                    splash.Dispose();
                }
            }
        };
        anim.Start();
    }

    static void RebuildAndRestart()
    {
        // 1. 봇 프로세스 종료 (알림 전송 후 Kill)
        string name = string.IsNullOrEmpty(computerName) ? "" : " [" + computerName + "]";
        try { SendTelegram("🔄 " + L("bot_stopped") + name + "\n재빌드 후 재시작합니다."); } catch { }
        try { SendLawBotTelegram("🔄 법률 도우미 봇이 종료됩니다. 재빌드 후 재시작합니다."); } catch { }
        StopLawBot(silent: true);
        try
        {
            if (botProcess != null && !botProcess.HasExited)
            {
                botProcess.Kill();
                botProcess.WaitForExit(3000);
            }
        }
        catch { }

        // 2. npm install (새 의존성 설치)
        try
        {
            ProcessStartInfo npmPsi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c npm install --production",
                WorkingDirectory = botDir,
                WindowStyle = ProcessWindowStyle.Hidden,
                CreateNoWindow = true,
                UseShellExecute = false
            };
            npmPsi.EnvironmentVariables["PATH"] = fullPath;
            Process npmProc = Process.Start(npmPsi);
            npmProc.WaitForExit(60000);
        }
        catch { }

        // 3. launcher.cs → exe 재빌드
        string cscPath = @"C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe";
        string launcherCs = Path.Combine(botDir, "launcher.cs");
        string icoPath = Path.Combine(botDir, "app.ico");
        string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
        string tempExe = exePath + ".new";

        if (File.Exists(cscPath) && File.Exists(launcherCs))
        {
            try
            {
                string args = "/nologo /target:winexe /out:\"" + tempExe + "\" \"" + launcherCs + "\"";
                if (File.Exists(icoPath))
                    args = "/nologo /target:winexe /win32icon:\"" + icoPath + "\" /out:\"" + tempExe + "\" \"" + launcherCs + "\"";

                ProcessStartInfo cscPsi = new ProcessStartInfo
                {
                    FileName = cscPath,
                    Arguments = args,
                    WorkingDirectory = botDir,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process cscProc = Process.Start(cscPsi);
                cscProc.WaitForExit(30000);

                if (cscProc.ExitCode == 0 && File.Exists(tempExe))
                {
                    // 자기 자신을 교체하고 재실행
                    string batPath = Path.Combine(botDir, "dist", "_rebuild.bat");
                    File.WriteAllText(batPath,
                        "@echo off\r\n" +
                        "timeout /t 1 /nobreak >nul\r\n" +
                        "move /y \"" + tempExe + "\" \"" + exePath + "\"\r\n" +
                        "start \"\" \"" + exePath + "\"\r\n" +
                        "del \"%~f0\"\r\n",
                        Encoding.ASCII);

                    Process.Start(new ProcessStartInfo
                    {
                        FileName = batPath,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        CreateNoWindow = true,
                        UseShellExecute = true
                    });

                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                    if (appMutex != null) { appMutex.ReleaseMutex(); appMutex.Dispose(); appMutex = null; }
                    Application.Exit();
                    return;
                }
                else
                {
                    // 빌드 실패 시 임시 파일 정리
                    try { File.Delete(tempExe); } catch { }
                }
            }
            catch { }
        }

        // exe 재빌드 실패 또는 csc 없으면 봇만 재시작
        ParseEnv(Path.Combine(botDir, ".env"));
        fullPath = GetFullPath();
        botProcess = Process.Start(CreateNodeStartInfo(botJsPath, botDir));
    }

    static void RestartBot(string dir, string botJs)
    {
        try
        {
            if (!botProcess.HasExited)
            {
                botProcess.Kill();
                botProcess.WaitForExit(3000);
            }
        }
        catch { }

        ParseEnv(Path.Combine(dir, ".env"));
        fullPath = GetFullPath();
        botProcess = Process.Start(CreateNodeStartInfo(botJs, dir));
    }

    static void StopBot()
    {
        StopLawBot();
        try
        {
            if (!botProcess.HasExited)
            {
                string name = string.IsNullOrEmpty(computerName) ? "" : " [" + computerName + "]";
                SendTelegram(L("bot_stopped") + name);
                botProcess.Kill();
                botProcess.WaitForExit(3000);
            }
        }
        catch { }

        trayIcon.Visible = false;
        trayIcon.Dispose();
        if (appMutex != null) { appMutex.ReleaseMutex(); appMutex.Dispose(); appMutex = null; }
        Application.Exit();
    }

    static void ParseEnv(string path)
    {
        if (!File.Exists(path)) return;
        foreach (string line in File.ReadAllLines(path))
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith("#")) continue;
            int eq = trimmed.IndexOf('=');
            if (eq < 0) continue;
            string key = trimmed.Substring(0, eq).Trim();
            string val = trimmed.Substring(eq + 1).Trim();
            if (key == "TELEGRAM_BOT_TOKEN") botToken = val;
            if (key == "AUTHORIZED_USER_ID") chatId = val;
            if (key == "COMPUTER_NAME") computerName = val;
        }
    }

    static bool IsAutoStartEnabled()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", false))
            {
                return key != null && key.GetValue(AutoStartKey) != null;
            }
        }
        catch { return false; }
    }

    static void ToggleAutoStart()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
            {
                if (key == null) return;
                if (IsAutoStartEnabled())
                {
                    key.DeleteValue(AutoStartKey, false);
                }
                else
                {
                    string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
                    key.SetValue(AutoStartKey, "\"" + exePath + "\"");
                }
            }
        }
        catch { }
    }

    static void SendTelegram(string text)
    {
        if (string.IsNullOrEmpty(botToken) || string.IsNullOrEmpty(chatId)) return;
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            using (WebClient client = new WebClient())
            {
                client.Headers[HttpRequestHeader.ContentType] = "application/json; charset=utf-8";
                client.Encoding = Encoding.UTF8;
                string body = "{\"chat_id\":\"" + chatId + "\",\"text\":\"" + text + "\"}";
                client.UploadString("https://api.telegram.org/bot" + botToken + "/sendMessage", body);
            }
        }
        catch { }
    }
}
