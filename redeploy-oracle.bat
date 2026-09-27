@echo off
title Guilded - Update the Oracle bot
echo This pushes the newest code on GitHub's main branch out to the live bot
echo (guildedqc.duckdns.org) and restarts it. The database updates itself.
echo Expect about 15 seconds where the bot is offline.
echo.
pause

ssh -i "%USERPROFILE%\.ssh\guilded_oracle" -o StrictHostKeyChecking=accept-new ubuntu@168.138.70.194 "cd ~/guilded && sudo bash deploy/update.sh"

if errorlevel 1 (
  echo.
  echo ============================================================
  echo  Something went wrong. Scroll up to see what the server said.
  echo  Common causes: you have not pushed your latest changes to
  echo  GitHub yet, or the server lost its network for a moment.
  echo ============================================================
) else (
  echo.
  echo ============================================================
  echo  Done. Check Discord with /report ping to confirm.
  echo ============================================================
)
pause
