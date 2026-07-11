@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "BOT_TITLE=QQ_FARM_BOT"
set "BOT_PORT=3007"
set "PNPM_CMD="

where pnpm >nul 2>nul
if errorlevel 1 (
    where corepack >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Neither pnpm nor corepack was found.
        pause
        exit /b 1
    )
    set "PNPM_CMD=corepack pnpm"
) else (
    set "PNPM_CMD=pnpm"
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%BOT_PORT%" ^| findstr "LISTENING"') do (
    echo [INFO] QQ Farm is already running. PID=%%P, PORT=%BOT_PORT%
    pause
    exit /b 0
)

if not exist "%~dp0core\node_modules" (
    echo [INFO] Installing workspace dependencies...
    call %PNPM_CMD% install -r
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
)

if not exist "%~dp0web\dist\index.html" (
    echo [INFO] Web dist not found, building once...
    call %PNPM_CMD% -C web build
    if errorlevel 1 (
        echo [ERROR] Web build failed.
        pause
        exit /b 1
    )
)

echo [INFO] Opening QQ Farm console...
start "%BOT_TITLE%" cmd /k "cd /d "%~dp0" && call %PNPM_CMD% -C core dev"

echo [OK] QQ Farm launch command sent.
echo [INFO] Panel: http://localhost:%BOT_PORT%
exit /b 0
