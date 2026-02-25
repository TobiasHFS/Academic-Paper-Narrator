@echo off
TITLE Academic Paper Narrator - Launcher
SETLOCAL EnableDelayedExpansion

:: Ensure we are in the script's directory
cd /d "%~dp0"

echo ===================================================
echo       Academic Paper Narrator Launcher
echo ===================================================

:: 1. Check if Node.js is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please install it from https://nodejs.org/
    pause
    exit
)

:: 2. Handle API Key / .env
set KEY_FOUND=0
IF EXIST .env (
    findstr /C:"VITE_GEMINI_API_KEY" .env >nul 2>&1 && set KEY_FOUND=1
)

IF !KEY_FOUND! equ 0 (
    echo.
    echo [!] Gemini API Key not found in .env
    echo Please enter your Google Gemini API Key.
    echo (You can get one at: https://aistudio.google.com/app/apikey)
    echo.
    set /p API_KEY="Enter API Key: "
    
    :: Overwrite or create .env with the key
    echo VITE_GEMINI_API_KEY=!API_KEY! > .env
    echo [^+] .env file updated successfully.
)

:: 3. Install dependencies if missing
if not exist "node_modules" (
    echo [INFO] Installing dependencies, please wait...
    call npm install
)

:: 4. Start the app
echo.
echo [^+] Starting the application...
echo ---------------------------------------------------
echo  1. Keep this window open while using the app.
echo  2. Close this window to stop the app.
echo  3. Open http://localhost:5173 if it doesn't open.
echo ---------------------------------------------------
echo.

call npm run dev

pause
