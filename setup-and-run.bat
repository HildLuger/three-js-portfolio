@echo off
echo Setting up Three.js project...
echo.

echo Installing dependencies...
npm install

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to install dependencies.
    echo Please make sure Node.js is installed and try again.
    echo You can download Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo.
echo Dependencies installed successfully!
echo.
echo Starting development server...
echo The project will be available at: http://localhost:3000
echo.
npm run dev
