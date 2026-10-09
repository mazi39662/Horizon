@echo off
title Boss Finance Dashboard
cd /d "%~dp0"
set "PY=C:\Users\VICTUS\AppData\Local\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=python"
echo Starting Boss Finance on http://localhost:8851 ...
echo Close this window to stop the dashboard.
"%PY%" server.py
pause
