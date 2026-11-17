@echo off
cd /d "%~dp0"
if not exist data\pdfs mkdir data\pdfs
echo ============================================
echo   ZYCG Board  (Central Gov Procurement)
echo   Local : http://127.0.0.1:8000
echo   LAN   : http://  <this PC LAN IP>  :8000
echo   First run seeds ~14 days (a few minutes).
echo   Keep this window open; Ctrl+C to stop.
echo ============================================
python\python.exe server.py 8000
pause
