@echo off
setlocal EnableExtensions

set "BOT_TITLE=QQ_FARM_BOT"
set "BOT_PORT=3007"
set "STOPPED=0"

tasklist /v /fi "WINDOWTITLE eq %BOT_TITLE%" | findstr /i "%BOT_TITLE%" >nul 2>nul
if not errorlevel 1 (
    taskkill /fi "WINDOWTITLE eq %BOT_TITLE%" /t /f >nul 2>nul
    set "STOPPED=1"
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%BOT_PORT%" ^| findstr "LISTENING"') do (
    taskkill /pid %%P /t /f >nul 2>nul
    set "STOPPED=1"
)

if "%STOPPED%"=="1" (
    echo [OK] QQ Farm stopped.
) else (
    echo [INFO] QQ Farm is not running.
)

pause
exit /b 0
