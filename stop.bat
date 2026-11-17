@echo off
setlocal
set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
  taskkill /f /pid %%a >nul 2>&1
  set FOUND=1
)
if "%FOUND%"=="1" (echo Stopped ZYCG board on port 8000.) else (echo No ZYCG board process found on port 8000.)
endlocal
