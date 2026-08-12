@echo off
REM Run this ONCE on a new machine, from the project root folder.
REM It installs dependencies and creates .env files (you still need to
REM fill in real values afterwards - see SETUP.md).

echo ============================================
echo   Installing backend dependencies...
echo ============================================
cd backend
call npm install
if not exist .env (
    copy .env.example .env
    echo Created backend\.env - remember to fill in your real values!
) else (
    echo backend\.env already exists, leaving it as-is.
)
cd ..

echo.
echo ============================================
echo   Installing frontend dependencies...
echo ============================================
cd frontend
call npm install
if not exist .env.local (
    copy .env.local.example .env.local
    echo Created frontend\.env.local
) else (
    echo frontend\.env.local already exists, leaving it as-is.
)
cd ..

echo.
echo ============================================
echo   Setup complete!
echo ============================================
echo Next steps:
echo   1. Open backend\.env in Notepad and fill in your real Supabase values.
echo      (See SETUP.md for exactly what to put there.)
echo   2. Double-click start-all.bat to run the app.
echo.
pause
