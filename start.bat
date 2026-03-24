@echo off
if not exist "venv\Scripts\activate.bat" (
    echo Virtual environment not found. Run install steps from README first.
    exit /b 1
)
call venv\Scripts\activate.bat
uvicorn encoder.main:app --port 8765 %*
