@echo off
setlocal

set INSTALL_DIR=%~dp0

:: ── Pull ──────────────────────────────────────────────────────────────────────
echo ^>^>^> Pulling latest changes...
git -C "%INSTALL_DIR%" pull
if errorlevel 1 ( echo ERROR: git pull failed & exit /b 1 )

:: ── Python venv ───────────────────────────────────────────────────────────────
:: Recreate venv if broken or Python version changed
set VENV=%INSTALL_DIR%venv
set VENV_OK=0

if exist "%VENV%\Scripts\python.exe" (
    for /f "tokens=*" %%v in ('"%VENV%\Scripts\python.exe" --version 2^>^&1') do set VENV_PY=%%v
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set SYS_PY=%%v
    if "!VENV_PY!"=="!SYS_PY!" (
        "%VENV%\Scripts\python.exe" -c "import pip" >nul 2>&1
        if not errorlevel 1 set VENV_OK=1
    )
)

if "%VENV_OK%"=="0" (
    echo ^>^>^> Recreating Python virtual environment...
    if exist "%VENV%" rmdir /s /q "%VENV%"
    python -m venv "%VENV%"
    if errorlevel 1 ( echo ERROR: failed to create venv & exit /b 1 )
)

echo ^>^>^> Installing Python dependencies...
call "%VENV%\Scripts\activate.bat"
pip install -e "%INSTALL_DIR%" -q
if errorlevel 1 ( echo ERROR: pip install failed & exit /b 1 )

:: ── Frontend ──────────────────────────────────────────────────────────────────
echo ^>^>^> Installing frontend dependencies...
npm install --prefix "%INSTALL_DIR%frontend" --silent
if errorlevel 1 ( echo ERROR: npm install failed & exit /b 1 )

echo ^>^>^> Building frontend...
npm run build --prefix "%INSTALL_DIR%frontend"
if errorlevel 1 ( echo ERROR: frontend build failed & exit /b 1 )

:: ── Done ──────────────────────────────────────────────────────────────────────
echo.
echo Update complete. Restart the server:
echo   start.bat
echo.
