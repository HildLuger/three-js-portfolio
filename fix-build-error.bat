@echo off
echo Fixing Next.js/Turbopack build error...
echo.

echo Step 1: Removing parent lockfile (if exists)...
if exist "C:\Users\marin\package-lock.json" (
    echo Found parent package-lock.json, removing...
    del "C:\Users\marin\package-lock.json"
)

if exist "C:\Users\marin\node_modules" (
    echo Found parent node_modules, removing...
    rmdir /s /q "C:\Users\marin\node_modules"
)

echo.
echo Step 2: Cleaning project build artifacts...
if exist .next rmdir /s /q .next
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del package-lock.json

echo.
echo Step 3: Cleaning npm cache...
npm cache clean --force

echo.
echo Step 4: Installing dependencies with React 18 stack...
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
echo Step 5: Verifying React installation...
npm ls react

echo.
echo Dependencies installed successfully!
echo.
echo Starting development server...
echo The Three.js project will be available at: http://localhost:3000
echo.
echo Features:
echo - Interactive 3D scene with React Three Fiber
echo - Real-time material editor with PBR controls
echo - Smooth scrolling with Locomotive Scroll
echo - Responsive design with Tailwind CSS
echo.
npm run dev
