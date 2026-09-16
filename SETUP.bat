@echo off
REM Spiro ERP - one-time setup: creates the database and seeds demo data
cd /d "%~dp0server"
node scripts/setup-win.js
pause
