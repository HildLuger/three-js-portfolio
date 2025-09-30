Write-Host "Fixing Next.js/Turbopack build error..." -ForegroundColor Green
Write-Host ""

Write-Host "Step 1: Removing parent lockfile (if exists)..." -ForegroundColor Yellow
if (Test-Path "C:\Users\marin\package-lock.json") {
    Write-Host "Found parent package-lock.json, removing..." -ForegroundColor Red
    Remove-Item -Force "C:\Users\marin\package-lock.json"
}

if (Test-Path "C:\Users\marin\node_modules") {
    Write-Host "Found parent node_modules, removing..." -ForegroundColor Red
    Remove-Item -Recurse -Force "C:\Users\marin\node_modules"
}

Write-Host ""
Write-Host "Step 2: Cleaning project build artifacts..." -ForegroundColor Yellow
if (Test-Path ".next") { Remove-Item -Recurse -Force ".next" }
if (Test-Path "node_modules") { Remove-Item -Recurse -Force "node_modules" }
if (Test-Path "package-lock.json") { Remove-Item -Force "package-lock.json" }

Write-Host ""
Write-Host "Step 3: Cleaning npm cache..." -ForegroundColor Yellow
npm cache clean --force

Write-Host ""
Write-Host "Step 4: Installing dependencies with React 18 stack..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Failed to install dependencies." -ForegroundColor Red
    Write-Host "Please make sure Node.js is installed and try again." -ForegroundColor Red
    Write-Host "You can download Node.js from: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Step 5: Verifying React installation..." -ForegroundColor Yellow
npm ls react

Write-Host ""
Write-Host "Dependencies installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Starting development server..." -ForegroundColor Yellow
Write-Host "The Three.js project will be available at: http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Features:" -ForegroundColor Cyan
Write-Host "- Interactive 3D scene with React Three Fiber" -ForegroundColor White
Write-Host "- Real-time material editor with PBR controls" -ForegroundColor White
Write-Host "- Smooth scrolling with Locomotive Scroll" -ForegroundColor White
Write-Host "- Responsive design with Tailwind CSS" -ForegroundColor White
Write-Host ""
npm run dev
