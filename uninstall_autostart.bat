@echo off
schtasks /delete /tn "ZYCGBoard" /f >nul 2>&1
del "%USERPROFILE%\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\ZYCGBoard.lnk" >nul 2>&1
echo Removed ZYCG board auto-start.
pause
