@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ── Pull ──────────────────────────────────────────────────────────────────────
echo ^>^>^> Pulling latest changes...
git pull
if errorlevel 1 ( echo ERROR: git pull failed & pause & exit /b 1 )

:: ── Python venv ───────────────────────────────────────────────────────────────
set VENV_OK=0
if exist "venv\Scripts\python.exe" (
    for /f "tokens=*" %%v in ('"venv\Scripts\python.exe" --version 2^>^&1') do set VENV_PY=%%v
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set SYS_PY=%%v
    if "!VENV_PY!"=="!SYS_PY!" (
        "venv\Scripts\python.exe" -c "import pip" >nul 2>&1
        if not errorlevel 1 set VENV_OK=1
    )
)
if "!VENV_OK!"=="0" (
    echo ^>^>^> Recreating Python virtual environment...
    if exist "venv" rmdir /s /q "venv"
    python -m venv venv
    if errorlevel 1 ( echo ERROR: failed to create venv & pause & exit /b 1 )
)

echo ^>^>^> Installing Python dependencies...
call "venv\Scripts\activate.bat"
pip install -e . -q
if errorlevel 1 ( echo ERROR: pip install failed & pause & exit /b 1 )

:: ── Frontend ──────────────────────────────────────────────────────────────────
echo ^>^>^> Installing frontend dependencies...
npm install --prefix frontend --silent
if errorlevel 1 ( echo ERROR: npm install failed & pause & exit /b 1 )

echo ^>^>^> Building frontend...
npm run build --prefix frontend
if errorlevel 1 ( echo ERROR: frontend build failed & pause & exit /b 1 )

:: ── Kill server on port 8765 (uvicorn runs as python.exe, kill by port) ───────
echo ^>^>^> Stopping existing server...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765 " ^| findstr "LISTENING"') do (
    echo    Killing PID %%a on port 8765
    taskkill /f /pid %%a >nul 2>&1
)

:: ── Start server in new window ────────────────────────────────────────────────
echo ^>^>^> Starting server...
start "video-encoder" "%~dp0start.bat"

echo.
echo Update complete^^! Server starting in a new window.
echo   http://localhost:8765
echo.
