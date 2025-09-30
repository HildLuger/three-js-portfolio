# PowerShell script to run the Next.js development server
# This script handles the PowerShell syntax issues

Write-Host "Installing dependencies..." -ForegroundColor Green
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "Starting development server..." -ForegroundColor Green
    npm run dev
} else {
    Write-Host "Failed to install dependencies. Please check if Node.js and npm are installed." -ForegroundColor Red
    Write-Host "You can download Node.js from: https://nodejs.org/" -ForegroundColor Yellow
}
