@echo off
setlocal

set "ROOT=%~dp0"

echo Starting Vorliq blockchain API on port 5001...
start "Vorliq Blockchain API" cmd /k "cd /d ""%ROOT%blockchain"" && call .venv\Scripts\activate.bat && python app.py"

timeout /t 3 /nobreak >nul

echo Starting Vorliq backend API on port 5000...
start "Vorliq Backend API" cmd /k "cd /d ""%ROOT%backend"" && node index.js"

timeout /t 3 /nobreak >nul

echo Starting Vorliq React frontend on port 3000...
start "Vorliq Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm start"

echo Vorliq is starting. Open http://localhost:3000 in your browser.
endlocal
