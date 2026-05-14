@echo off
setlocal

set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "stress_test" mkdir "stress_test"

call "blockchain\.venv\Scripts\activate.bat"
python "stress_test\simulate_network.py" > "stress_test\results.txt" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

type "stress_test\results.txt"
exit /b %EXIT_CODE%
