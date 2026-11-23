@echo off
setlocal
cd /d "%~dp0"
echo.
echo ============================================
echo   KITCHEN^&KO BLOG STUDIO v2  (debug start)
echo ============================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js LTS from https://nodejs.org
  pause
  exit /b 1
)
node --version
node launcher.js --debug
if errorlevel 1 (
  echo.
  echo [ERROR] Start failed. Check launcher.log / server.log in this folder.
  pause
  exit /b 1
)
echo.
echo [OK] Browser opened. You can close this window.
timeout /t 5 >nul
