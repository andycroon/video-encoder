@echo off
cd /d "%~dp0"
if not exist "venv\Scripts\activate.bat" (
    echo Virtual environment not found. Run install steps from README first.
    pause
    exit /b 1
)
call venv\Scripts\activate.bat
uvicorn encoder.main:app --host 0.0.0.0 --port 8765 %*
