@echo off
echo Installing dependencies...
npm install

if %errorlevel% equ 0 (
    echo Starting development server...
    npm run dev
) else (
    echo Failed to install dependencies. Please check if Node.js and npm are installed.
    echo You can download Node.js from: https://nodejs.org/
    pause
)
