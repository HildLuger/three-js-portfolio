@echo off
echo Cleaning and reinstalling dependencies for Three.js project...
echo.

echo Removing old node_modules...
if exist node_modules rmdir /s /q node_modules

echo Removing package-lock.json...
if exist package-lock.json del package-lock.json

echo.
echo Installing fresh dependencies...
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
echo The Three.js project will be available at: http://localhost:3000
echo.
echo Features:
echo - Interactive 3D scene with 5 mesh types
echo - Real-time material editor with PBR controls
echo - Smooth scrolling with Locomotive Scroll
echo - Responsive design with Tailwind CSS
echo.
npm run dev
