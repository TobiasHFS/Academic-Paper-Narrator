@echo off
SETLOCAL EnableDelayedExpansion

echo ========================================
echo   Academic Paper Narrator Launcher
echo ========================================

IF NOT EXIST .env (
    echo [!] .env file not found.
    set /p API_KEY="Enter your Google Gemini API Key: "
    echo VITE_GEMINI_API_KEY=!API_KEY! > .env
    echo [^+] .env file created with your API key.
)

echo [^+] Installing dependencies (if needed)...
call npm install

echo [^+] Starting the application...
echo [^+] Open http://localhost:5173 in your browser.
call npm run dev

pause
