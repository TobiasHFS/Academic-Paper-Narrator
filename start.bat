@echo off
setlocal
cd /d "%~dp0"
if not exist .env.local (
    echo Copy .env.example to .env.local and add your own API key first.
    pause
    exit /b 1
)
if not exist node_modules (
    call npm ci
    if errorlevel 1 exit /b 1
)
call npm run dev
