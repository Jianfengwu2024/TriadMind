@echo off
REM TRIADMIND_BOOTSTRAP_VERSION={{BOOTSTRAP_VERSION}}
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%session-bootstrap.ps1" %*
exit /b %ERRORLEVEL%
