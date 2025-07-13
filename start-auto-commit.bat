@echo off
echo Auto-Commit Script Starter
echo.

if "%~1"=="" (
    echo Usage: Drag a folder onto this batch file to start auto-commit
    echo Or run: start-auto-commit.bat "C:\path\to\your\project"
    pause
    exit /b
)

echo Starting auto-commit for: %1
echo.

cd /d "%~dp0"
node auto-commit-global.js "%1"

pause 