@echo off
cd /d "%~dp0"
if not exist data\pdfs mkdir data\pdfs
:loop
python\python.exe server.py 8000
echo [%date% %time%] server stopped; restarting in 10s...
timeout /t 10 /nobreak >nul
goto loop
