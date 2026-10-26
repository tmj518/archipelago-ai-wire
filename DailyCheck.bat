@echo off
rem ---------------------------------------------------------------------------
rem DailyCheck.bat - run this before you go to sleep, and read the last line.
rem
rem Two things decide whether the 08:10 run succeeds:
rem   1. the proxy (the accelerator) must be up - with it off the push fails
rem   2. the environment, the build and the gates must be clear
rem
rem This checks both and prints ALL CLEAR or the reason it is not.
rem
rem The real work is in tools\check-preflight.ps1, because this file must stay
rem pure ASCII: cmd.exe reads a .bat in the OEM code page, and this project sits
rem in a folder whose path contains non-ASCII characters, so any non-ASCII byte
rem here would be misread.
rem ---------------------------------------------------------------------------
setlocal
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%tools\check-preflight.ps1"
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo ==========================================================
  echo   ALL CLEAR - the 08:10 run should complete. Sleep well.
  echo ==========================================================
) else (
  echo ==========================================================
  echo   NOT CLEAR - fix the above before sleeping.
  echo ==========================================================
)
echo.
pause
exit /b %CODE%
