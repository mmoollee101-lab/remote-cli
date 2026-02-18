@echo off
chcp 65001 >nul 2>&1
title Claude Telegram Bot - Setup

echo ═══════════════════════════════════════
echo   Claude Telegram Bot - 초기 설정
echo ═══════════════════════════════════════
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js가 설치되어 있지 않습니다.
    echo   https://nodejs.org 에서 Node.js 20+ 설치 후 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER%

:: Check Claude Code CLI
where claude >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Claude Code CLI가 설치되어 있지 않습니다.
    echo   설치 명령: npm install -g @anthropic-ai/claude-code
    echo.
    set /p INSTALL_CLAUDE="지금 설치하시겠습니까? (Y/N): "
    if /i "%INSTALL_CLAUDE%"=="Y" (
        npm install -g @anthropic-ai/claude-code
    ) else (
        echo   나중에 수동으로 설치하세요.
    )
) else (
    echo [OK] Claude Code CLI
)

:: npm install
echo.
echo 의존성 패키지 설치 중...
call npm install --production
echo [OK] npm install 완료

:: Create .env if not exists
if not exist .env (
    echo.
    echo ─── .env 설정 ───
    echo.
    set /p BOT_TOKEN="Telegram Bot Token (BotFather에서 발급): "
    set /p COMP_NAME="컴퓨터 이름 (예: 집PC, 회사PC): "

    (
        echo # Telegram Bot Token ^(BotFather에서 발급^)
        echo TELEGRAM_BOT_TOKEN=%BOT_TOKEN%
        echo.
        echo # 허용된 Telegram 유저 ID ^(봇에 /start 보내면 콘솔에 출력됨^)
        echo AUTHORIZED_USER_ID=
        echo.
        echo # 컴퓨터 이름 ^(텔레그램에 표시됨^)
        echo COMPUTER_NAME=%COMP_NAME%
    ) > .env

    echo.
    echo [OK] .env 파일 생성됨
    echo [INFO] 봇 실행 후 텔레그램에서 /start 보내면 유저 ID가 콘솔에 출력됩니다.
    echo        출력된 ID를 .env의 AUTHORIZED_USER_ID에 입력하세요.
) else (
    echo.
    echo [OK] .env 파일이 이미 존재합니다.
)

:: Build launcher exe
if not exist dist mkdir dist
echo.
echo 런처 빌드 중...
C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /nologo /target:winexe /win32icon:app.ico /out:"dist\Claude Telegram Bot.exe" launcher.cs >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] dist\Claude Telegram Bot.exe 빌드 완료
) else (
    echo [WARN] exe 빌드 실패 — node bot.js로 직접 실행하세요.
)

echo.
echo ═══════════════════════════════════════
echo   설정 완료!
echo.
echo   실행 방법:
echo     1. dist\Claude Telegram Bot.exe 더블클릭
echo     2. 또는: node bot.js
echo ═══════════════════════════════════════
echo.
pause
