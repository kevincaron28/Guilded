@echo off
setlocal
title Guilded - Update the Oracle bot
set "REPO=%~dp0"

echo Checking that this checkout is clean and exactly matches GitHub main...
git -C "%REPO%" fetch origin main:refs/remotes/origin/main
if errorlevel 1 goto preflight_failed

for /f %%i in ('git -C "%REPO%" branch --show-current') do set "BRANCH=%%i"
if not "%BRANCH%"=="main" (
  echo.
  echo ERROR: This checkout is on "%BRANCH%", not main. Switch to main and try again.
  goto failed
)

set "DIRTY="
for /f "delims=" %%i in ('git -C "%REPO%" status --porcelain --untracked-files=all -- . ":(exclude)AUDIT.md" ":(exclude)Screenshots/**"') do set "DIRTY=1"
if defined DIRTY (
  echo.
  echo ERROR: There are uncommitted or untracked changes in this checkout.
  echo Redeploy only uses commits published to GitHub. Review, commit, and push
  echo the changes you want deployed, then run this file again.
  goto failed
)

for /f %%i in ('git -C "%REPO%" rev-parse HEAD') do set "LOCAL_SHA=%%i"
for /f %%i in ('git -C "%REPO%" rev-parse origin/main') do set "REMOTE_SHA=%%i"
if not "%LOCAL_SHA%"=="%REMOTE_SHA%" (
  echo.
  echo ERROR: This checkout is not at GitHub's latest main commit.
  echo Local:      %LOCAL_SHA%
  echo GitHub main: %REMOTE_SHA%
  echo Synchronize main, then run this file again.
  goto failed
)

echo.
echo Ready to deploy GitHub main commit %REMOTE_SHA%.
echo This updates the live bot (guildedqc.duckdns.org) and restarts it.
echo The database applies migrations during startup.
echo Expect about 15 seconds where the bot is offline.
echo.
pause

ssh -i "%USERPROFILE%\.ssh\guilded_oracle" -o StrictHostKeyChecking=accept-new ubuntu@168.138.70.194 "cd ~/guilded && sudo bash deploy/update.sh"

if errorlevel 1 (
  echo.
  goto failed
) else (
  echo.
  echo ============================================================
  echo  Done. The server prints the deployed commit SHA above.
  echo  Check Discord with /report ping to confirm.
  echo ============================================================
)
pause
exit /b 0

:preflight_failed
echo.
echo ERROR: Could not fetch GitHub main. Check your network and GitHub access.
goto failed

:failed
echo.
echo ============================================================
echo  Redeploy stopped or failed. Scroll up for the reason.
echo ============================================================
pause
exit /b 1
