@echo off
rem Music Atlas backend supervisor - keeps node server.cjs alive (auto-restart)
cd /d "%~dp0"
:loop
node server.cjs >> server-runtime.log 2>&1
echo [%date% %time%] backend exited, restarting in 3s >> server-runtime.log
timeout /t 3 /nobreak >nul
goto loop
