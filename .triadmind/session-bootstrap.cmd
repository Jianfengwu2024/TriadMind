@echo off
REM TRIADMIND_BOOTSTRAP_VERSION=1.0
setlocal
set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%session-bootstrap.ps1" %*
set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%
