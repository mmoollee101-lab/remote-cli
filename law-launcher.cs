using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

class LawBotTrayLauncher
{
    static Process lawBotProcess;
    static NotifyIcon trayIcon;
    static System.Threading.Mutex appMutex;
    static readonly string AutoStartKey = "LawBot";

    static string currentLang = "ko";
    static string lawBotDir;
    static string lawBotJsPath;
    static string logPath;
    static bool lawBotEnabled = false;
    static int lawBotCrashCount = 0;
    static string fullPath;

    // ─── PATH / Node discovery ──────────────────────────────────
    static string GetFullPath()
    {
        string machinePath = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) ?? "";
        string userPath = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? "";
        string processPath = Environment.GetEnvironmentVariable("PATH") ?? "";
        HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        List<string> parts = new List<string>();
        foreach (string src in new string[] { processPath, userPath, machinePath })
        {
            foreach (string dir in src.Split(';'))
            {
                string trimmed = dir.Trim();
                if (trimmed.Length > 0 && seen.Add(trimmed)) parts.Add(trimmed);
            }
        }
        return string.Join(";", parts);
    }

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
        foreach (string p in commonPaths) { if (File.Exists(p)) return p; }
        return "node";
    }

    static ProcessStartInfo CreateNodeStartInfo(string js, string dir)
    {
        string nodePath = FindNodePath();
        ProcessStartInfo psi = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = "\"" + js + "\"",
            WorkingDirectory = dir,
            WindowStyle = ProcessWindowStyle.Hidden,
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        psi.EnvironmentVariables["PATH"] = fullPath;
        return psi;
    }

    // ─── Language (read from law-bot/.env LANG=) ────────────────
    static string ReadLangFromEnv()
    {
        try
        {
            string envPath = Path.Combine(lawBotDir, ".env");
            if (!File.Exists(envPath)) return "ko";
            foreach (string line in File.ReadAllLines(envPath))
            {
                string trimmed = line.Trim();
                if (trimmed.StartsWith("#")) continue;
                int eq = trimmed.IndexOf('=');
                if (eq < 0) continue;
                string key = trimmed.Substring(0, eq).Trim();
                string val = trimmed.Substring(eq + 1).Trim();
                if (key == "LANG") return val == "en" ? "en" : "ko";
            }
        }
        catch { }
        return "ko";
    }

    static string L(string key)
    {
        if (currentLang == "en")
        {
            switch (key)
            {
                case "app_title": return "Law Bot";
                case "start": return "Start Law Bot";
                case "stop": return "Stop Law Bot";
                case "settings": return "Settings";
                case "log": return "View Log";
                case "autostart": return "Start with Windows";
                case "restart": return "Restart";
                case "quit": return "Quit";
                case "already_running": return "Law Bot is already running.";
                case "bot_not_found": return "law-bot.js not found.\n\nPath: {0}";
                case "node_not_found": return "node.exe not found.\n\nPlease install Node.js.\nhttps://nodejs.org";
                case "not_configured": return "Law Bot is not configured.\nRight-click tray \u2192 Settings";
                case "env_title": return "Law Bot Settings";
                case "env_guide": return "Step 1. Telegram \u2192 @BotFather \u2192 /newbot\n             \u2192 Create a SEPARATE bot for legal questions\n             \u2192 Copy the token \u2192 paste below\n\nStep 2. Go to open.law.go.kr \u2192 Sign up \u2192 Get API key\n             \u2192 Paste API key below\n\nStep 3. Send /start to the legal bot in Telegram\n             \u2192 Copy User IDs of family members\n             \u2192 Paste below (comma separated)";
                case "token_hint": return "Create a NEW bot via @BotFather";
                case "oc_hint": return "Register at open.law.go.kr \u2192 My Page \u2192 API Key";
                case "users_hint": return "Auto-added when you approve via Telegram. Or enter manually (comma separated)";
                case "admin_label": return "\uD83D\uDC51 Admin ID *";
                case "admin_hint": return "Your Telegram User ID (send /start to bot to find it)";
                case "users_label": return "\uD83D\uDC65 Users";
                case "autostart_check": return "Start Law Bot with Windows";
                case "autostart_hint": return "Enable only on the PC where law bot should run (avoid duplicates)";
                case "save": return "\uD83D\uDCBE Save";
                case "cancel": return "Close";
                case "saved": return "\u2705 Saved!";
                case "token_required": return "Telegram Bot Token is required.";
                case "oc_required": return "Law API Key is required.";
                case "bot_stopped": return "\uD83D\uDD34 Law Bot has been stopped.";
            }
        }
        switch (key)
        {
            case "app_title": return "법률 봇";
            case "start": return "법률 봇 시작";
            case "stop": return "법률 봇 중지";
            case "settings": return "⚙️ 설정";
            case "log": return "📋 로그 보기";
            case "autostart": return "🚀 윈도우 시작 시 자동 실행";
            case "restart": return "🔄 재시작";
            case "quit": return "❌ 종료";
            case "already_running": return "법률 봇이 이미 실행 중입니다.";
            case "bot_not_found": return "law-bot.js를 찾을 수 없습니다.\n\n경로: {0}";
            case "node_not_found": return "node.exe를 찾을 수 없습니다.\n\nNode.js가 설치되어 있는지 확인하세요.\nhttps://nodejs.org";
            case "not_configured": return "법률 봇이 설정되지 않았습니다.\n트레이 우클릭 → 설정";
            case "env_title": return "법률 봇 설정";
            case "env_guide": return "1단계. 텔레그램 → @BotFather → /newbot\n             → 법률 질문용 봇을 별도로 만드세요\n             → 토큰 복사 → 아래에 붙여넣기\n\n2단계. open.law.go.kr 접속 → 회원가입 → API 키 발급\n             → 아래에 API 키 붙여넣기\n\n3단계. 법률 봇에 /start 전송\n             → 가족 멤버들의 유저 ID 복사\n             → 아래에 쉼표로 구분하여 붙여넣기";
            case "token_hint": return "@BotFather에서 새 봇 생성";
            case "oc_hint": return "open.law.go.kr → 마이페이지 → API 키 발급";
            case "users_hint": return "텔레그램에서 승인하면 자동 추가. 직접 입력도 가능 (쉼표 구분)";
            case "admin_label": return "👑 관리자 ID *";
            case "admin_hint": return "본인의 텔레그램 유저 ID (봇에 /start 보내면 확인)";
            case "users_label": return "👥 사용자 목록";
            case "autostart_check": return "윈도우 시작 시 자동 실행";
            case "autostart_hint": return "법률봇을 실행할 컴퓨터에서만 켜세요 (중복 실행 방지)";
            case "save": return "💾 저장";
            case "cancel": return "닫기";
            case "saved": return "✅ 저장됨!";
            case "token_required": return "텔레그램 봇 토큰은 필수입니다.";
            case "oc_required": return "법제처 API 키는 필수입니다.";
            case "bot_stopped": return "🔴 법률 봇이 종료되었습니다.";
        }
        return key;
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

        string envPath = Path.Combine(lawBotDir, ".env");
        if (!File.Exists(envPath))
        {
            if (!silent) MessageBox.Show(L("not_configured"), L("app_title"), MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        // 409 Conflict 방지 — law-bot.js 가 polling 시작하기 전에 launcher poller 중지
        StopOfflinePoller();

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
                npmProc.WaitForExit(120000);
            }
            catch { }
        }

        try
        {
            ProcessStartInfo psi = CreateNodeStartInfo(lawBotJsPath, lawBotDir);
            lawBotProcess = Process.Start(psi);

            // stdout/stderr → law-bot.log
            System.Threading.ThreadPool.QueueUserWorkItem(_ => {
                try
                {
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
                }
                catch { }
            });
            System.Threading.ThreadPool.QueueUserWorkItem(_ => {
                try
                {
                    using (StreamWriter sw = new StreamWriter(logPath, true, Encoding.UTF8))
                    {
                        sw.AutoFlush = true;
                        while (lawBotProcess != null && !lawBotProcess.HasExited)
                        {
                            string line = lawBotProcess.StandardError.ReadLine();
                            if (line != null) sw.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] ERR: " + line);
                        }
                    }
                }
                catch { }
            });

            lawBotEnabled = true;
            if (!silent) SendLawBotTelegram("🟢 법률 도우미 봇이 시작되었습니다. 질문을 보내주세요!");
        }
        catch { lawBotEnabled = false; }
    }

    static void StopLawBot(bool silent = false)
    {
        lawBotEnabled = false;
        if (!silent)
        {
            // 관리자에게만 종료 알림 (사용자 broadcast 금지 — 점검 중 알림은 사용자가 메시지 보낼 때만 회신)
            SendLawBotTelegram("🔴 법률 도우미 봇이 종료되었습니다.");
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
        lawBotProcess = null;
        try { File.Delete(Path.Combine(lawBotDir, "law-bot.lock")); } catch { }

        // 봇이 꺼져있는 동안 offline poller 가 사용자 메시지에 "점검 중" 회신 전담
        StartOfflinePoller();
    }

    // ─── Offline Poller ─────────────────────────────────────────
    // 봇이 꺼져있는 동안 launcher가 직접 Telegram getUpdates 폴링.
    // 사용자가 메시지를 보낼 때만 "점검 중" 회신 (한 offline 세션당 사용자별 1회).
    static System.Threading.Thread offlinePollerThread;
    static volatile bool offlinePollerRunning = false;
    static long offlineLastUpdateId = 0;
    static HashSet<string> offlineRepliedChats = new HashSet<string>();
    static readonly object offlinePollerLock = new object();

    static void StartOfflinePoller()
    {
        lock (offlinePollerLock)
        {
            if (offlinePollerRunning) return;
            // 새 offline 세션 시작 — 회신 dedup 초기화
            offlineRepliedChats.Clear();
            offlinePollerRunning = true;
        }
        offlinePollerThread = new System.Threading.Thread(OfflinePollerLoop);
        offlinePollerThread.IsBackground = true;
        offlinePollerThread.Start();
    }

    static void StopOfflinePoller()
    {
        lock (offlinePollerLock) { offlinePollerRunning = false; }
        // 스레드 종료 대기 (long-poll 끝날 때까지 최대 ~12초)
        if (offlinePollerThread != null)
        {
            try { offlinePollerThread.Join(13000); } catch { }
            offlinePollerThread = null;
        }
    }

    static void OfflinePollerLoop()
    {
        while (true)
        {
            lock (offlinePollerLock) { if (!offlinePollerRunning) return; }
            try { OfflinePollOnce(); }
            catch { }
            // 짧은 sleep — long-poll(timeout=10) 자체가 대부분의 대기를 함
            for (int i = 0; i < 10; i++)
            {
                lock (offlinePollerLock) { if (!offlinePollerRunning) return; }
                System.Threading.Thread.Sleep(100);
            }
        }
    }

    static void OfflinePollOnce()
    {
        string envPath = Path.Combine(lawBotDir, ".env");
        if (!File.Exists(envPath)) return;
        string token = "";
        foreach (string line in File.ReadAllLines(envPath))
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith("#")) continue;
            int eq = trimmed.IndexOf('=');
            if (eq < 0) continue;
            if (trimmed.Substring(0, eq).Trim() == "TELEGRAM_BOT_TOKEN")
            {
                token = trimmed.Substring(eq + 1).Trim();
                break;
            }
        }
        if (string.IsNullOrEmpty(token)) return;

        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            string url = "https://api.telegram.org/bot" + token
                + "/getUpdates?timeout=10&allowed_updates=%5B%22message%22%5D&offset="
                + (offlineLastUpdateId + 1);
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.Timeout = 15000;
            req.ReadWriteTimeout = 15000;
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            {
                string json = sr.ReadToEnd();
                ProcessUpdates(token, json);
            }
        }
        catch (WebException wex)
        {
            // 409 Conflict → law-bot.js 가 이미 polling 중. 조용히 종료.
            try
            {
                HttpWebResponse hr = wex.Response as HttpWebResponse;
                if (hr != null && (int)hr.StatusCode == 409)
                {
                    lock (offlinePollerLock) { offlinePollerRunning = false; }
                }
            }
            catch { }
        }
        catch { }
    }

    static void ProcessUpdates(string token, string json)
    {
        // update_id 와 그 뒤 message.chat.id 쌍을 추출
        // typical: {"update_id":123,"message":{...,"chat":{"id":456,...}}}
        MatchCollection matches = Regex.Matches(
            json,
            "\"update_id\"\\s*:\\s*(\\d+)[\\s\\S]*?\"chat\"\\s*:\\s*\\{\\s*\"id\"\\s*:\\s*(-?\\d+)");
        foreach (Match m in matches)
        {
            long updateId;
            if (!long.TryParse(m.Groups[1].Value, out updateId)) continue;
            if (updateId > offlineLastUpdateId) offlineLastUpdateId = updateId;

            string chatId = m.Groups[2].Value;
            if (string.IsNullOrEmpty(chatId)) continue;

            // 한 offline 세션 동안 같은 사용자에게는 1회만 회신
            bool alreadyReplied;
            lock (offlinePollerLock)
            {
                alreadyReplied = offlineRepliedChats.Contains(chatId);
                if (!alreadyReplied) offlineRepliedChats.Add(chatId);
            }
            if (alreadyReplied) continue;

            TelegramSend(token, chatId,
                "🔧 법률 도우미 봇이 잠시 점검 중입니다.\n곧 다시 시작될 예정이니 잠시 후 다시 질문해주세요.");
        }
    }

    static void SendLawBotTelegram(string text)
    {
        string envPath = Path.Combine(lawBotDir, ".env");
        if (!File.Exists(envPath)) return;
        string token = "";
        string users = "";
        foreach (string line in File.ReadAllLines(envPath))
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith("#")) continue;
            int eq = trimmed.IndexOf('=');
            if (eq < 0) continue;
            string key = trimmed.Substring(0, eq).Trim();
            string val = trimmed.Substring(eq + 1).Trim();
            if (key == "TELEGRAM_BOT_TOKEN") token = val;
            if (key == "AUTHORIZED_USERS") users = val;
        }
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(users)) return;
        string adminEntry = users.Split(',')[0].Trim();
        string adminId = adminEntry.Contains(":") ? adminEntry.Substring(0, adminEntry.IndexOf(':')) : adminEntry;
        if (adminId.Length == 0) return;
        TelegramSend(token, adminId, text);
    }

    static void TelegramSend(string token, string chatId, string text)
    {
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(
                "https://api.telegram.org/bot" + token + "/sendMessage");
            req.Method = "POST";
            req.ContentType = "application/json; charset=utf-8";
            req.Timeout = 5000;
            byte[] data = Encoding.UTF8.GetBytes(
                "{\"chat_id\":\"" + chatId + "\",\"text\":\"" + text + "\"}");
            req.ContentLength = data.Length;
            using (Stream s = req.GetRequestStream()) { s.Write(data, 0, data.Length); }
            using (req.GetResponse()) { }
        }
        catch { }
    }

    // ─── Settings Dialog ────────────────────────────────────────
    static void ShowSettingsDialog()
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

        string[] userList = existingUsers.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
        string existingAdmin = userList.Length > 0 ? userList[0].Trim() : "";
        List<string> existingMembers = new List<string>();
        for (int i = 1; i < userList.Length; i++)
        {
            string u = userList[i].Trim();
            if (u.Length > 0) existingMembers.Add(u);
        }
        Func<string, string> displayUser = (entry) => {
            int colonIdx = entry.IndexOf(':');
            if (colonIdx > 0 && colonIdx < entry.Length - 1)
                return entry.Substring(0, colonIdx) + " (" + entry.Substring(colonIdx + 1) + ")";
            return entry;
        };
        Func<string, string> restoreUser = (display) => {
            int parenIdx = display.IndexOf(" (");
            if (parenIdx > 0 && display.EndsWith(")"))
                return display.Substring(0, parenIdx) + ":" + display.Substring(parenIdx + 2, display.Length - parenIdx - 3);
            return display.Trim();
        };

        Form form = new Form();
        form.Text = L("app_title") + " \u2014 " + L("env_title");
        form.Size = new Size(520, 830);
        form.StartPosition = FormStartPosition.CenterScreen;
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.MinimizeBox = false;
        form.Font = new Font("Malgun Gothic", 9.5f);

        int pad = 20;
        int inputW = 450;
        int y = pad;

        Label lblTitle = new Label {
            Text = L("app_title") + " \u2696\uFE0F",
            Location = new Point(pad, y),
            AutoSize = true,
            Font = new Font("Malgun Gothic", 14f, FontStyle.Bold)
        };
        y += 35;

        Label lblGuide = new Label {
            Text = L("env_guide"),
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

        Label lblToken = new Label { Text = "Telegram Bot Token *", Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtToken = new TextBox { Location = new Point(pad, y), Width = inputW, Text = existingToken };
        y += 30;
        Label lblTokenHint = new Label { Text = L("token_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 25;

        Label lblOC = new Label { Text = "Law API Key (OC) *", Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtOC = new TextBox { Location = new Point(pad, y), Width = inputW, Text = existingOC };
        y += 30;
        Label lblOCHint = new Label { Text = L("oc_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 30;

        Label sep2 = new Label {
            Location = new Point(pad, y),
            Size = new Size(inputW, 1),
            BorderStyle = BorderStyle.Fixed3D
        };
        y += 15;

        Label lblAdmin = new Label { Text = L("admin_label"), Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtAdmin = new TextBox { Location = new Point(pad, y), Width = inputW, Text = displayUser(existingAdmin) };
        y += 30;
        Label lblAdminHint = new Label { Text = L("admin_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 25;

        Label lblUsers = new Label { Text = L("users_label"), Location = new Point(pad, y), AutoSize = true, Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
        y += 22;
        TextBox txtUsers = new TextBox {
            Location = new Point(pad, y), Width = inputW,
            Text = string.Join(", ", existingMembers.ConvertAll(m => displayUser(m))),
            BackColor = Color.FromArgb(245, 245, 248)
        };
        y += 30;
        Label lblUsersHint = new Label { Text = L("users_hint"), Location = new Point(pad, y), AutoSize = true, ForeColor = Color.Gray, Font = new Font("Malgun Gothic", 8f) };
        y += 30;

        Label sep3 = new Label {
            Location = new Point(pad, y),
            Size = new Size(inputW, 1),
            BorderStyle = BorderStyle.Fixed3D
        };
        y += 15;
        CheckBox chkAutoStart = new CheckBox {
            Text = L("autostart_check"),
            Location = new Point(pad, y),
            AutoSize = true,
            Checked = IsAutoStartEnabled(),
            Font = new Font("Malgun Gothic", 9.5f)
        };
        y += 25;
        Label lblAutoHint = new Label { Text = L("autostart_hint"), Location = new Point(pad, y), Size = new Size(inputW, 30), ForeColor = Color.FromArgb(200, 80, 80), Font = new Font("Malgun Gothic", 8f) };
        y += 35;

        Button btnSave = new Button { Text = L("save"), Location = new Point(pad, y), Width = 160, Height = 38 };
        btnSave.BackColor = Color.FromArgb(124, 58, 237);
        btnSave.ForeColor = Color.White;
        btnSave.FlatStyle = FlatStyle.Flat;
        btnSave.Font = new Font("Malgun Gothic", 10f, FontStyle.Bold);
        Button btnCancel = new Button { Text = L("cancel"), Location = new Point(pad + 170, y), Width = 100, Height = 38 };
        btnCancel.FlatStyle = FlatStyle.Flat;

        y += 50;
        Button btnExport = new Button { Text = "📤 설정 내보내기", Location = new Point(pad, y), Width = 220, Height = 34 };
        btnExport.FlatStyle = FlatStyle.Flat;
        btnExport.Font = new Font("Malgun Gothic", 9f);
        btnExport.ForeColor = Color.FromArgb(59, 130, 246);
        Button btnImport = new Button { Text = "📥 설정 가져오기", Location = new Point(pad + 230, y), Width = 220, Height = 34 };
        btnImport.FlatStyle = FlatStyle.Flat;
        btnImport.Font = new Font("Malgun Gothic", 9f);
        btnImport.ForeColor = Color.FromArgb(59, 130, 246);

        btnExport.Click += (s, e) =>
        {
            string admin = restoreUser(txtAdmin.Text.Trim());
            string[] expParts = txtUsers.Text.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            List<string> expMembers = new List<string>();
            foreach (string ep in expParts) { string r = restoreUser(ep.Trim()); if (r.Length > 0) expMembers.Add(r); }
            string combined = admin;
            if (expMembers.Count > 0) combined += "," + string.Join(",", expMembers);
            string raw = "TELEGRAM_BOT_TOKEN=" + txtToken.Text.Trim()
                       + "|LAW_OC=" + txtOC.Text.Trim()
                       + "|AUTHORIZED_USERS=" + combined;
            string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(raw));
            Clipboard.SetText(encoded);
            btnExport.Text = "✅ 클립보드에 복사됨";
            Timer t = new Timer { Interval = 2000 };
            t.Tick += (s2, e2) => { btnExport.Text = "📤 설정 내보내기"; t.Stop(); t.Dispose(); };
            t.Start();
        };

        btnImport.Click += (s, e) =>
        {
            Form dlg = new Form { Text = "설정 가져오기", Width = 480, Height = 220, StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false };
            Label lbl = new Label { Text = "내보내기 코드를 붙여넣으세요:", Location = new Point(12, 12), AutoSize = true };
            TextBox txtCode = new TextBox { Location = new Point(12, 36), Width = 440, Height = 80, Multiline = true, ScrollBars = ScrollBars.Vertical };
            Button btnApply = new Button { Text = "적용", Location = new Point(270, 130), Width = 88, Height = 32, DialogResult = DialogResult.OK };
            Button btnClose = new Button { Text = "취소", Location = new Point(364, 130), Width = 88, Height = 32, DialogResult = DialogResult.Cancel };
            dlg.AcceptButton = btnApply;
            dlg.CancelButton = btnClose;
            dlg.Controls.AddRange(new Control[] { lbl, txtCode, btnApply, btnClose });

            if (dlg.ShowDialog() != DialogResult.OK) return;
            string input = txtCode.Text.Trim();
            if (string.IsNullOrEmpty(input)) { MessageBox.Show("코드가 비어있습니다.", "알림"); return; }
            try
            {
                string decoded = Encoding.UTF8.GetString(Convert.FromBase64String(input));
                var parts = decoded.Split('|');
                foreach (var part in parts)
                {
                    int eq = part.IndexOf('=');
                    if (eq < 0) continue;
                    string key = part.Substring(0, eq);
                    string val = part.Substring(eq + 1);
                    if (key == "TELEGRAM_BOT_TOKEN") txtToken.Text = val;
                    else if (key == "LAW_OC") txtOC.Text = val;
                    else if (key == "AUTHORIZED_USERS")
                    {
                        string[] ids = val.Split(',');
                        txtAdmin.Text = ids.Length > 0 ? displayUser(ids[0].Trim()) : "";
                        if (ids.Length > 1)
                        {
                            List<string> impMembers = new List<string>();
                            for (int ii = 1; ii < ids.Length; ii++) { string im = ids[ii].Trim(); if (im.Length > 0) impMembers.Add(displayUser(im)); }
                            txtUsers.Text = string.Join(", ", impMembers);
                        }
                        else txtUsers.Text = "";
                    }
                }
                btnImport.Text = "✅ 설정 적용됨";
                Timer t = new Timer { Interval = 2000 };
                t.Tick += (s2, e2) => { btnImport.Text = "📥 설정 가져오기"; t.Stop(); t.Dispose(); };
                t.Start();
            }
            catch
            {
                MessageBox.Show("올바른 설정 코드가 아닙니다.\n내보내기로 생성된 코드를 붙여넣으세요.", "오류", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        };

        btnSave.Click += (s, e) =>
        {
            if (string.IsNullOrWhiteSpace(txtToken.Text))
            {
                MessageBox.Show(L("token_required"), "Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (string.IsNullOrWhiteSpace(txtOC.Text))
            {
                MessageBox.Show(L("oc_required"), "Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string admin = restoreUser(txtAdmin.Text.Trim());
            string[] memberParts = txtUsers.Text.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            List<string> restoredMembers = new List<string>();
            foreach (string mp in memberParts) { string r = restoreUser(mp.Trim()); if (r.Length > 0) restoredMembers.Add(r); }
            string combined = admin;
            if (restoredMembers.Count > 0) combined += "," + string.Join(",", restoredMembers);

            StringBuilder sb = new StringBuilder();
            sb.AppendLine("# Telegram Bot Token (BotFather - law bot)");
            sb.AppendLine("TELEGRAM_BOT_TOKEN=" + txtToken.Text.Trim());
            sb.AppendLine();
            sb.AppendLine("# Law API Key (open.law.go.kr)");
            sb.AppendLine("LAW_OC=" + txtOC.Text.Trim());
            sb.AppendLine();
            sb.AppendLine("# Authorized Users (format: id:name) first = admin");
            sb.AppendLine("AUTHORIZED_USERS=" + combined);
            sb.AppendLine();
            sb.AppendLine("# Language");
            sb.AppendLine("LANG=" + currentLang);

            File.WriteAllText(envPath, sb.ToString(), Encoding.UTF8);
            btnSave.Text = L("saved");
            btnSave.BackColor = Color.FromArgb(34, 197, 94);
            Timer resetTimer = new Timer { Interval = 2000 };
            resetTimer.Tick += (s2, e2) => {
                btnSave.Text = L("save");
                btnSave.BackColor = Color.FromArgb(124, 58, 237);
                resetTimer.Stop();
                resetTimer.Dispose();
            };
            resetTimer.Start();

            SetAutoStart(chkAutoStart.Checked);

            StopLawBot(silent: true);
            lawBotCrashCount = 0;
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
            btnSave, btnCancel,
            btnExport, btnImport
        });
        form.AcceptButton = btnSave;
        form.CancelButton = btnCancel;
        form.ShowDialog();
    }

    // ─── Tray Menu ──────────────────────────────────────────────
    static void BuildMenu()
    {
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Font = new Font("Malgun Gothic", 9);

        bool running = IsLawBotRunning();
        ToolStripMenuItem startStop = new ToolStripMenuItem(running ? L("stop") : L("start"));
        startStop.Click += (s, e) => {
            if (IsLawBotRunning()) StopLawBot();
            else { lawBotCrashCount = 0; StartLawBot(); }
            BuildMenu();
        };
        menu.Items.Add(startStop);

        menu.Items.Add(L("settings"), null, (s, e) => ShowSettingsDialog());
        menu.Items.Add(L("log"), null, (s, e) => {
            if (File.Exists(logPath)) Process.Start("notepad", logPath);
        });

        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem autoStartItem = new ToolStripMenuItem(L("autostart"));
        autoStartItem.Checked = IsAutoStartEnabled();
        autoStartItem.Click += (s, e) => {
            SetAutoStart(!IsAutoStartEnabled());
            BuildMenu();
        };
        menu.Items.Add(autoStartItem);

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(L("restart"), null, (s, e) => {
            StopLawBot(silent: true);
            lawBotCrashCount = 0;
            StartLawBot();
            BuildMenu();
        });
        menu.Items.Add(L("quit"), null, (s, e) => QuitApp());

        trayIcon.ContextMenuStrip = menu;
    }

    static void QuitApp()
    {
        StopOfflinePoller();
        StopLawBot();
        StopOfflinePoller();  // StopLawBot이 다시 시작했을 수 있으므로 한 번 더
        if (trayIcon != null) { trayIcon.Visible = false; trayIcon.Dispose(); }
        if (appMutex != null) { try { appMutex.ReleaseMutex(); } catch { } appMutex.Dispose(); appMutex = null; }
        Application.Exit();
    }

    // ─── Windows Auto-Start (Registry) ──────────────────────────
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

    static void SetAutoStart(bool enable)
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
            {
                if (key == null) return;
                if (enable)
                {
                    string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
                    key.SetValue(AutoStartKey, "\"" + exePath + "\"");
                }
                else
                {
                    key.DeleteValue(AutoStartKey, false);
                }
            }
        }
        catch { }
    }

    // ─── Migration from legacy bot-state.json ───────────────────
    static void MigrateFromLegacyState()
    {
        // One-shot: if HKCU\Run\LawBot missing AND bot-state.json has lawBotAutoStart=true,
        // create the registry entry so user doesn't need to re-enable auto-start.
        try
        {
            if (IsAutoStartEnabled()) return;
            string rootStatePath = Path.Combine(lawBotDir, "..", "bot-state.json");
            rootStatePath = Path.GetFullPath(rootStatePath);
            if (!File.Exists(rootStatePath)) return;
            string content = File.ReadAllText(rootStatePath, Encoding.UTF8);
            Match m = Regex.Match(content, "\"lawBotAutoStart\"\\s*:\\s*(true|false)");
            if (m.Success && m.Groups[1].Value == "true")
            {
                SetAutoStart(true);
            }
        }
        catch { }
    }

    [STAThread]
    static void Main()
    {
        bool createdNew;
        appMutex = new System.Threading.Mutex(true, "LawBot_SingleInstance", out createdNew);
        if (!createdNew)
        {
            MessageBox.Show(L("already_running"), L("app_title"), MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        // Paths: exe lives in <root>\dist\Law Bot.exe, so lawBotDir = <root>\law-bot
        string baseDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        lawBotDir = Path.Combine(baseDir, "law-bot");
        lawBotJsPath = Path.Combine(lawBotDir, "law-bot.js");
        logPath = Path.Combine(lawBotDir, "law-bot.log");

        currentLang = ReadLangFromEnv();

        if (!File.Exists(lawBotJsPath))
        {
            MessageBox.Show(string.Format(L("bot_not_found"), lawBotJsPath),
                "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        fullPath = GetFullPath();
        string nodePath = FindNodePath();
        if (nodePath == "node")
        {
            MessageBox.Show(L("node_not_found"), "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        MigrateFromLegacyState();

        // Start law-bot (if .env exists, else prompt settings)
        if (File.Exists(Path.Combine(lawBotDir, ".env")))
        {
            StartLawBot();
        }
        else
        {
            ShowSettingsDialog();
        }

        Application.EnableVisualStyles();

        trayIcon = new NotifyIcon();
        trayIcon.Text = L("app_title");
        trayIcon.Visible = true;
        try { trayIcon.Icon = Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location); }
        catch { trayIcon.Icon = SystemIcons.Application; }

        BuildMenu();
        trayIcon.DoubleClick += (s, e) => {
            if (File.Exists(logPath)) Process.Start("notepad", logPath);
        };

        // Crash watch — auto-restart (max 3 retries)
        Timer timer = new Timer();
        timer.Interval = 2000;
        timer.Tick += (s, e) =>
        {
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
                BuildMenu();
            }
        };
        timer.Start();

        Application.Run();
    }
}
