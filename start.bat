@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo installing dependencies ^(first run^)...
  call npm install
)
node server.js %*
pause
