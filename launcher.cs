using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Windows.Forms;

class TrayLauncher
{
    static Process botProcess;
    static NotifyIcon trayIcon;
    static string logPath;
    static string botToken;
    static string chatId;
    static string computerName;

    [STAThread]
    static void Main()
    {
        string dir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        string botJs = Path.Combine(dir, "bot.js");
        logPath = Path.Combine(dir, "bot.log");

        if (!File.Exists(botJs))
        {
            MessageBox.Show("bot.js not found.\n\n경로: " + botJs + "\n\ndist/ 폴더 안에 이 exe가 있어야 합니다.",
                "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        ParseEnv(Path.Combine(dir, ".env"));

        // Start bot hidden via node
        botProcess = Process.Start(new ProcessStartInfo
        {
            FileName = "node",
            Arguments = "\"" + botJs + "\"",
            WorkingDirectory = dir,
            WindowStyle = ProcessWindowStyle.Hidden,
            CreateNoWindow = true
        });

        Application.EnableVisualStyles();

        string label = string.IsNullOrEmpty(computerName)
            ? "Claude Telegram Bot"
            : "Claude Telegram Bot [" + computerName + "]";

        // Tray icon
        trayIcon = new NotifyIcon();
        trayIcon.Text = label;
        trayIcon.Visible = true;

        // Load icon from exe resource, fallback to system icon
        trayIcon.Icon = Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location);

        // Context menu
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Font = new Font("Malgun Gothic", 9);
        menu.Items.Add("📖 설명서", null, (s, e) => ShowGuide());
        menu.Items.Add("📋 로그 보기", null, (s, e) => OpenLog());
        menu.Items.Add("📂 .env 편집", null, (s, e) => OpenEnv(dir));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("🔄 재시작", null, (s, e) => RestartBot(dir, botJs));
        menu.Items.Add("❌ 종료", null, (s, e) => StopBot());

        trayIcon.ContextMenuStrip = menu;
        trayIcon.DoubleClick += (s, e) => OpenLog();

        // Watch for bot crash
        Timer timer = new Timer();
        timer.Interval = 2000;
        timer.Tick += (s, e) =>
        {
            if (botProcess.HasExited) StopBot();
        };
        timer.Start();

        Application.Run();
    }

    static void ShowGuide()
    {
        Form guide = new Form();
        guide.Text = "Claude Telegram Bot - 설명서";
        guide.Size = new Size(560, 520);
        guide.StartPosition = FormStartPosition.CenterScreen;
        guide.FormBorderStyle = FormBorderStyle.FixedDialog;
        guide.MaximizeBox = false;
        guide.MinimizeBox = false;
        guide.Font = new Font("Malgun Gothic", 9.5f);

        TextBox tb = new TextBox();
        tb.Multiline = true;
        tb.ReadOnly = true;
        tb.ScrollBars = ScrollBars.Vertical;
        tb.Dock = DockStyle.Fill;
        tb.BackColor = Color.White;
        tb.Text =
@"═══════════════════════════════════════
  Claude Telegram Bot  -  설정 가이드
═══════════════════════════════════════

텔레그램으로 Claude Code CLI를 원격 제어하는 봇입니다.

──── 사전 요구사항 ────
• Node.js 20 이상 설치
• Claude Code CLI 설치 (npm i -g @anthropic-ai/claude-code)
• Claude Code에 로그인 완료 (claude 한번 실행)

──── 설치 방법 ────
1. 이 폴더에서 npm install 실행
2. .env 파일을 편집 (트레이 메뉴 → .env 편집)

──── .env 설정 ────

TELEGRAM_BOT_TOKEN=봇토큰
  → @BotFather에서 /newbot으로 봇 생성 후 발급

AUTHORIZED_USER_ID=유저ID
  → 봇 실행 후 텔레그램에서 /start 보내면 콘솔에 출력됨

COMPUTER_NAME=내PC
  → 텔레그램에 표시될 컴퓨터 이름 (선택사항)
  → 여러 컴퓨터에서 사용할 때 구분용

──── 여러 컴퓨터에서 사용하기 ────
1. BotFather에서 컴퓨터마다 별도 봇 생성
2. 각 컴퓨터에 이 프로그램 설치
3. .env에 각자 다른 봇 토큰 + COMPUTER_NAME 설정
4. 텔레그램에서 채팅방 골라서 사용

──── 텔레그램 명령어 ────
/start    - 봇 시작 + 유저 ID 확인
/new      - 새 세션 시작
/status   - 현재 상태 (세션, 디렉토리)
/setdir   - 작업 디렉토리 변경
/cancel   - 현재 작업 취소
/files    - 파일 목록 보기
/read     - 파일 내용 읽기

──── 권한 모드 ────
🔒 안전 모드: 파일 읽기만 자동 허용, 나머지는 거부
⚡ 전체 허용: 모든 도구 사용 자동 허용

──── 트러블슈팅 ────
• 봇이 안 켜지면: node가 PATH에 있는지 확인
• .env 변경 후: 트레이 메뉴 → 재시작
• 로그 확인: 트레이 메뉴 → 로그 보기
";

        guide.Controls.Add(tb);
        guide.Show();
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
            // .env.example이 있으면 복사
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

        // Re-read .env in case it changed
        ParseEnv(Path.Combine(dir, ".env"));

        botProcess = Process.Start(new ProcessStartInfo
        {
            FileName = "node",
            Arguments = "\"" + botJs + "\"",
            WorkingDirectory = dir,
            WindowStyle = ProcessWindowStyle.Hidden,
            CreateNoWindow = true
        });
    }

    static void StopBot()
    {
        try
        {
            if (!botProcess.HasExited)
            {
                string name = string.IsNullOrEmpty(computerName) ? "" : " [" + computerName + "]";
                SendTelegram("🔴 봇이 꺼졌습니다." + name);
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
