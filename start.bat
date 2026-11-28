@echo off
rem 本项目原创，MIT（licenses/MIT.md）
cd /d "%~dp0"
if not exist node_modules (
  echo installing dependencies ^(first run^)...
  call npm install
)
node server.js %*
pause
