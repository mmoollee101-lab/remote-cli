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

    static string L(string key)
    {
        if (currentLang == "en")
        {
            switch (key)
            {
                case "guide": return "📖 Guide";
                case "log": return "📋 View Log";
                case "env": return "📂 Edit .env";
                case "autostart": return "🚀 Start with Windows";
                case "restart": return "🔄 Restart";
                case "quit": return "❌ Quit";
                case "language": return "🌐 Language";
                case "guide_title": return "Claude Telegram Bot - Guide";
                case "guide_subtitle": return "Setup Guide";
                case "already_running": return "Already running.";
                case "bot_not_found": return "bot.js not found.\n\nPath: {0}\n\nThis exe must be inside the dist/ folder.";
                case "node_not_found": return "node.exe not found.\n\nPlease install Node.js.\nhttps://nodejs.org";
                case "bot_stopped": return "🔴 Bot has been stopped.";
            }
        }
        // Korean (default)
        switch (key)
        {
            case "guide": return "📖 설명서";
            case "log": return "📋 로그 보기";
            case "env": return "📂 .env 편집";
            case "autostart": return "🚀 윈도우 시작 시 자동 실행";
            case "restart": return "🔄 재시작";
            case "quit": return "❌ 종료";
            case "language": return "🌐 Language";
            case "guide_title": return "Claude Telegram Bot - 설명서";
            case "guide_subtitle": return "설정 가이드";
            case "already_running": return "이미 실행 중입니다.";
            case "bot_not_found": return "bot.js not found.\n\n경로: {0}\n\ndist/ 폴더 안에 이 exe가 있어야 합니다.";
            case "node_not_found": return "node.exe를 찾을 수 없습니다.\n\nNode.js가 설치되어 있는지 확인하세요.\nhttps://nodejs.org";
            case "bot_stopped": return "🔴 봇이 꺼졌습니다.";
        }
        return key;
    }

    static void BuildMenu()
    {
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Font = new Font("Malgun Gothic", 9);
        menu.Items.Add(L("guide"), null, (s, e) => ShowGuide());
        menu.Items.Add(L("log"), null, (s, e) => OpenLog());
        menu.Items.Add(L("env"), null, (s, e) => OpenEnv(botDir));
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

        menu.Items.Add(new ToolStripSeparator());
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
                else
                {
                    StopBot();
                }
            }
        };
        timer.Start();

        Application.Run();
    }

    static void ShowGuide()
    {
        Form guide = new Form();
        guide.Text = L("guide_title");
        guide.Size = new Size(600, 750);
        guide.StartPosition = FormStartPosition.CenterScreen;
        guide.FormBorderStyle = FormBorderStyle.FixedDialog;
        guide.MaximizeBox = false;
        guide.MinimizeBox = false;

        RichTextBox rtb = new RichTextBox();
        rtb.ReadOnly = true;
        rtb.Dock = DockStyle.Fill;
        rtb.BackColor = Color.White;
        rtb.BorderStyle = BorderStyle.None;
        rtb.Font = new Font("Consolas", 10f);

        string subtitle = L("guide_subtitle");
        string[] sections;

        if (currentLang == "en")
        {
            rtb.Text = GetGuideEN();
            sections = new string[] { "[Prerequisites]", "[Installation]", "[.env Settings]",
                "[Multiple Computers]", "[Telegram Commands]", "[Photo/File Upload]",
                "[Permission Modes]", "[Tray Menu]", "[Troubleshooting]" };
        }
        else
        {
            rtb.Text = GetGuideKO();
            sections = new string[] { "[사전 요구사항]", "[설치 방법]", "[.env 설정]",
                "[여러 컴퓨터에서 사용하기]", "[텔레그램 명령어]", "[사진/파일 보내기]",
                "[권한 모드]", "[트레이 메뉴]", "[트러블슈팅]" };
        }

        // 제목 볼드 처리
        rtb.Select(0, "Claude Telegram Bot".Length);
        rtb.SelectionFont = new Font("Malgun Gothic", 14f, FontStyle.Bold);

        rtb.Select("Claude Telegram Bot\r\n".Length, subtitle.Length);
        rtb.SelectionFont = new Font("Malgun Gothic", 11f);
        rtb.SelectionColor = Color.Gray;

        string text = rtb.Text;
        foreach (string sec in sections)
        {
            int idx = text.IndexOf(sec);
            if (idx >= 0)
            {
                rtb.Select(idx, sec.Length);
                rtb.SelectionFont = new Font("Malgun Gothic", 10.5f, FontStyle.Bold);
                rtb.SelectionColor = Color.FromArgb(50, 50, 50);
            }
        }

        rtb.Select(0, 0);
        rtb.Padding = new Padding(12, 12, 12, 12);

        guide.Controls.Add(rtb);
        guide.Show();
    }

    static string GetGuideKO()
    {
        return
            "Claude Telegram Bot\r\n" +
            "설정 가이드\r\n" +
            "\r\n" +
            "텔레그램으로 Claude Code CLI를 원격 제어하는 봇입니다.\r\n" +
            "\r\n" +
            "\r\n" +
            "[사전 요구사항]\r\n" +
            "\r\n" +
            "  - Node.js 20 이상 설치\r\n" +
            "  - Claude Code CLI 설치\r\n" +
            "    npm i -g @anthropic-ai/claude-code\r\n" +
            "  - Claude Code에 로그인 완료 (claude 한번 실행)\r\n" +
            "\r\n" +
            "\r\n" +
            "[설치 방법]\r\n" +
            "\r\n" +
            "  1. 이 폴더에서 npm install 실행\r\n" +
            "  2. .env 파일을 편집 (트레이 메뉴 > .env 편집)\r\n" +
            "\r\n" +
            "\r\n" +
            "[.env 설정]\r\n" +
            "\r\n" +
            "  TELEGRAM_BOT_TOKEN=봇토큰\r\n" +
            "    @BotFather에서 /newbot으로 봇 생성 후 발급\r\n" +
            "\r\n" +
            "  AUTHORIZED_USER_ID=유저ID\r\n" +
            "    봇 실행 후 텔레그램에서 /start 보내면 콘솔에 출력됨\r\n" +
            "\r\n" +
            "  COMPUTER_NAME=내PC\r\n" +
            "    텔레그램에 표시될 컴퓨터 이름 (선택사항)\r\n" +
            "    여러 컴퓨터에서 사용할 때 구분용\r\n" +
            "\r\n" +
            "\r\n" +
            "[여러 컴퓨터에서 사용하기]\r\n" +
            "\r\n" +
            "  1. BotFather에서 컴퓨터마다 별도 봇 생성\r\n" +
            "  2. 각 컴퓨터에 이 프로그램 설치\r\n" +
            "  3. .env에 각자 다른 봇 토큰 + COMPUTER_NAME 설정\r\n" +
            "  4. 텔레그램에서 채팅방 골라서 사용\r\n" +
            "\r\n" +
            "\r\n" +
            "[텔레그램 명령어]\r\n" +
            "\r\n" +
            "  /start     봇 시작 + 유저 ID 확인\r\n" +
            "  /new       새 세션 시작\r\n" +
            "  /resume    터미널 세션 이어받기\r\n" +
            "  /status    현재 상태 (세션, 디렉토리)\r\n" +
            "  /setdir    작업 디렉토리 변경\r\n" +
            "  /cancel    현재 작업 취소\r\n" +
            "  /files     파일 목록 보기\r\n" +
            "  /read      파일 내용 읽기\r\n" +
            "  /preview   파일 미리보기 (HTML/이미지/스크립트)\r\n" +
            "  /tunnel    터널 관리 (status/start/stop)\r\n" +
            "  /restart   봇 재시작\r\n" +
            "\r\n" +
            "\r\n" +
            "[사진/파일 보내기]\r\n" +
            "\r\n" +
            "  사진에 캡션을 달면 즉시 Claude에 전달됩니다.\r\n" +
            "  캡션 없이 사진만 보내면 후속 메시지를 기다립니다.\r\n" +
            "  → 메시지 입력 시 사진+텍스트가 함께 전달\r\n" +
            "  → '사진만 보내기' 버튼으로 사진만 전달 가능\r\n" +
            "\r\n" +
            "\r\n" +
            "[권한 모드]\r\n" +
            "\r\n" +
            "  안전 모드: 파일 읽기만 자동 허용, 나머지는 승인 필요\r\n" +
            "  전체 허용: 모든 도구 사용 자동 허용\r\n" +
            "\r\n" +
            "\r\n" +
            "[트레이 메뉴]\r\n" +
            "\r\n" +
            "  - 설명서: 이 화면\r\n" +
            "  - 로그 보기: bot.log 열기\r\n" +
            "  - .env 편집: 환경변수 설정\r\n" +
            "  - 윈도우 시작 시 자동 실행: 부팅 시 자동 시작 토글\r\n" +
            "  - Language: 한국어/English 전환\r\n" +
            "  - 재시작 / 종료\r\n" +
            "\r\n" +
            "\r\n" +
            "[트러블슈팅]\r\n" +
            "\r\n" +
            "  - 봇이 안 켜지면: node가 PATH에 있는지 확인\r\n" +
            "  - .env 변경 후: 트레이 메뉴 > 재시작\r\n" +
            "  - 로그 확인: 트레이 메뉴 > 로그 보기\r\n";
    }

    static string GetGuideEN()
    {
        return
            "Claude Telegram Bot\r\n" +
            "Setup Guide\r\n" +
            "\r\n" +
            "A bot that lets you remotely control Claude Code CLI via Telegram.\r\n" +
            "\r\n" +
            "\r\n" +
            "[Prerequisites]\r\n" +
            "\r\n" +
            "  - Node.js 20 or later\r\n" +
            "  - Claude Code CLI installed\r\n" +
            "    npm i -g @anthropic-ai/claude-code\r\n" +
            "  - Claude Code authenticated (run claude once)\r\n" +
            "\r\n" +
            "\r\n" +
            "[Installation]\r\n" +
            "\r\n" +
            "  1. Run npm install in this folder\r\n" +
            "  2. Edit .env file (Tray Menu > Edit .env)\r\n" +
            "\r\n" +
            "\r\n" +
            "[.env Settings]\r\n" +
            "\r\n" +
            "  TELEGRAM_BOT_TOKEN=your_token\r\n" +
            "    Create a bot via @BotFather /newbot\r\n" +
            "\r\n" +
            "  AUTHORIZED_USER_ID=your_id\r\n" +
            "    Send /start to the bot, ID shown in console\r\n" +
            "\r\n" +
            "  COMPUTER_NAME=MyPC\r\n" +
            "    Computer name shown in Telegram (optional)\r\n" +
            "    Useful when running on multiple computers\r\n" +
            "\r\n" +
            "\r\n" +
            "[Multiple Computers]\r\n" +
            "\r\n" +
            "  1. Create separate bots in BotFather for each PC\r\n" +
            "  2. Install this program on each computer\r\n" +
            "  3. Set different bot tokens + COMPUTER_NAME in .env\r\n" +
            "  4. Use different Telegram chats for each\r\n" +
            "\r\n" +
            "\r\n" +
            "[Telegram Commands]\r\n" +
            "\r\n" +
            "  /start     Start bot + show user ID\r\n" +
            "  /new       Start new session\r\n" +
            "  /resume    Resume terminal session\r\n" +
            "  /status    Current status (session, directory)\r\n" +
            "  /setdir    Change working directory\r\n" +
            "  /cancel    Cancel current task\r\n" +
            "  /files     List files\r\n" +
            "  /read      Read file contents\r\n" +
            "  /preview   Preview file (HTML/image/script)\r\n" +
            "  /tunnel    Tunnel management (status/start/stop)\r\n" +
            "  /restart   Restart bot\r\n" +
            "\r\n" +
            "\r\n" +
            "[Photo/File Upload]\r\n" +
            "\r\n" +
            "  Add a caption to a photo to send it to Claude immediately.\r\n" +
            "  Sending a photo without caption waits for a follow-up message.\r\n" +
            "  → Message + photo are sent together\r\n" +
            "  → Use 'Send photo only' button to send just the photo\r\n" +
            "\r\n" +
            "\r\n" +
            "[Permission Modes]\r\n" +
            "\r\n" +
            "  Safe Mode: Only read-only tools auto-approved\r\n" +
            "  Allow All: All tool uses auto-approved\r\n" +
            "\r\n" +
            "\r\n" +
            "[Tray Menu]\r\n" +
            "\r\n" +
            "  - Guide: This screen\r\n" +
            "  - View Log: Open bot.log\r\n" +
            "  - Edit .env: Configure environment variables\r\n" +
            "  - Start with Windows: Toggle auto-start on boot\r\n" +
            "  - Language: Switch between Korean/English\r\n" +
            "  - Restart / Quit\r\n" +
            "\r\n" +
            "\r\n" +
            "[Troubleshooting]\r\n" +
            "\r\n" +
            "  - Bot won't start: Check if node is in PATH\r\n" +
            "  - After .env changes: Tray Menu > Restart\r\n" +
            "  - Check logs: Tray Menu > View Log\r\n";
    }

    static void OpenLog()
    {
        if (File.Exists(logPath))
            Process.Start("notepad", logPath);
    }

    static void OpenEnv(string dir)
    {
        string envPath = Path.Combine(dir, ".env");
        if (!File.Exists(envPath))
        {
            string example = Path.Combine(dir, ".env.example");
            if (File.Exists(example))
                File.Copy(example, envPath);
            else
                File.WriteAllText(envPath, "TELEGRAM_BOT_TOKEN=\r\nAUTHORIZED_USER_ID=\r\nCOMPUTER_NAME=\r\n");
        }
        Process.Start("notepad", envPath);
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
