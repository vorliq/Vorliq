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

timeout /t 3 /nobreak >nul

echo Starting Vorliq node registry heartbeat...
start "Vorliq Registry Heartbeat" cmd /k "cd /d ""%ROOT%backend"" && node heartbeat.js"

timeout /t 3 /nobreak >nul

echo.
echo Vorliq is running. Open http://localhost:3000 in your browser.
echo To connect to another node ask them for their IP address and port 5001 and add it in the Network page.
endlocal
