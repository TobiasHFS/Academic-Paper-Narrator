@echo off
TITLE Academic Narrator - DO NOT CLOSE
echo ===================================================
echo       Academic Narrator Launcher
echo ===================================================

:: 1. Check if Node.js is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Node.js is not installed!
    echo.
    echo Please go to https://nodejs.org/ and install the "LTS" version.
    echo After installing, restart this script.
    echo.
    pause
    exit
)

:: 2. Check if dependencies are installed (look for node_modules)
if not exist "node_modules" (
    echo.
    echo [INFO] First run detected. Installing dependencies...
    echo This might take a minute. Please wait.
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit
    )
)

:: 3. Start the application
echo.
echo [SUCCESS] Starting the app...
echo.
echo ---------------------------------------------------
echo   1. The browser will open automatically.
echo   2. Keep this black window OPEN while using the app.
echo   3. Close this window to stop the app.
echo ---------------------------------------------------
echo.

call npm run dev
