@echo off
TITLE Academic Paper Narrator - Launcher
SETLOCAL EnableDelayedExpansion

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
IF NOT EXIST .env (
    echo.
    echo [!] First run detected: .env file missing.
    echo Please enter your Google Gemini API Key.
    echo (You can get one at: https://aistudio.google.com/app/apikey)
    echo.
    set /p API_KEY="Enter API Key: "
    echo VITE_GEMINI_API_KEY=!API_KEY! > .env
    echo [^+] .env file created successfully.
)

:: 3. Install dependencies if missing
if not exist "node_modules" (
    echo [INFO] Installing dependencies, please wait...
    call npm install
)

:: 4. Start the app
echo.
echo [SUCCESS] Starting the application...
echo ---------------------------------------------------
echo  1. Keep this window open while using the app.
echo  2. Close this window to stop the app.
echo  3. Open http://localhost:5173 if it doesn't open.
echo ---------------------------------------------------
echo.

call npm run dev

pause
