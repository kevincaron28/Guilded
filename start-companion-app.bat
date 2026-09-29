@echo off
setlocal
rem Opens the Guilded Companion desktop app (tray icon + window). No console window stays open.
rem First time: installs what it needs (npm install) and draws the icons.
rem The engine in ..\companion loads luaparse from this folder's node_modules.
if not exist "%~dp0node_modules\luaparse\luaparse.js" (
  echo Installing the companion engine's dependencies. Running: npm install
  pushd "%~dp0"
  call npm.cmd install
  popd
)
cd /d "%~dp0companion-app"
if not exist node_modules\electron\dist\electron.exe (
  echo The companion app is not installed yet. Running: npm install
  call npm.cmd install
)
if not exist assets\tray-setup.png call npm.cmd run icon
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0companion-app\node_modules\electron\dist\electron.exe" "%~dp0companion-app"
exit /b 0
