@echo off
setlocal

echo Stopping Vorliq services on ports 5000, 5001, and 3000...

for %%P in (5000 5001 3000) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    echo Stopping process %%A on port %%P...
    taskkill /PID %%A /T /F >nul 2>nul
  )
)

powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*heartbeat.js*' } | ForEach-Object { Write-Host ('Stopping registry heartbeat process ' + $_.ProcessId + '...'); Stop-Process -Id $_.ProcessId -Force }"

echo Vorliq services stopped.
endlocal
