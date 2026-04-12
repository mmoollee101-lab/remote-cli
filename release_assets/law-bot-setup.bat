@echo off
chcp 65001 >nul 2>&1
title Law Bot - Setup

echo ═══════════════════════════════════════
echo   법률 도우미 봇 - 초기 설정
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

:: npm install in law-bot folder
echo.
echo 법률 봇 의존성 패키지 설치 중...
pushd law-bot
call npm install --production --legacy-peer-deps
popd
echo [OK] npm install 완료

:: Generate icon if missing
if not exist law-app.ico (
    if exist make-law-icon.ps1 (
        echo.
        echo 법률 봇 아이콘 생성 중...
        powershell -ExecutionPolicy Bypass -File make-law-icon.ps1 >nul 2>&1
        if exist law-app.ico (
            echo [OK] law-app.ico 생성 완료
        )
    )
)

:: Build Law Bot launcher exe
if not exist dist mkdir dist
echo.
echo 법률 봇 런처 빌드 중...
if exist law-app.ico (
    set LAW_ICO=law-app.ico
) else (
    set LAW_ICO=
)
if defined LAW_ICO (
    C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /nologo /target:winexe /win32icon:%LAW_ICO% /out:"dist\Law Bot.exe" law-launcher.cs >nul 2>&1
) else (
    C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /nologo /target:winexe /out:"dist\Law Bot.exe" law-launcher.cs >nul 2>&1
)
if %errorlevel% equ 0 (
    echo [OK] dist\Law Bot.exe 빌드 완료
) else (
    echo [WARN] exe 빌드 실패 — node law-bot/law-bot.js 로 직접 실행하세요.
)

echo.
echo ═══════════════════════════════════════
echo   설정 완료!
echo.
echo   실행 방법:
echo     1. dist\Law Bot.exe 더블클릭
echo     2. 트레이 아이콘 우클릭 → 설정
echo     3. 텔레그램 봇 토큰 + 법제처 OC 키 + 사용자 ID 입력
echo.
echo   법률 봇은 메인 rcli와 완전히 독립 실행됩니다.
echo ═══════════════════════════════════════
echo.
pause
