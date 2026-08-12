@echo off
REM Starts the backend and frontend, each in its own Command Prompt window.
REM Run this by double-clicking it, from the project root folder.

echo Starting backend on http://localhost:3001 ...
start "Backend (NestJS)" cmd /k "cd backend && npm run start:dev"

echo Waiting a few seconds for the backend to boot...
timeout /t 5 /nobreak > nul

echo Starting frontend on http://localhost:3000 ...
start "Frontend (Next.js)" cmd /k "cd frontend && npm run dev"

echo.
echo Both servers are starting in separate windows.
echo Once both show "Ready" / "running", open http://localhost:3000 in your browser.
echo Leave both windows open while using the app.
pause
