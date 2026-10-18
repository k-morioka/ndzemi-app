@echo off
cd /d "%~dp0"
rem Open the browser after the server has started
start "" /b cmd /c "timeout /t 1 >nul & start http://localhost:8765/"
python server.py
pause
