; Extra uninstall cleanup for Guilded Companion.
;
; electron-builder's "deleteAppDataOnUninstall" option (set in package.json)
; already removes %APPDATA%\Guilded Companion (config.json, which holds the
; upload token and companion credential, plus Electron's cache folders) when
; the app is uninstalled from Windows Settings / Add or Remove Programs.
;
; What that flag does NOT touch is the "Start with Windows" entry: main.cjs
; turns autostart on by default on first run (app.setLoginItemSettings),
; which writes a per-user Run key pointing at this install's .exe. If it is
; left behind, Windows logs a silent failure every login after uninstall.
; Electron's app name (and so the registry value name it uses) is the
; package's "productName", "Guilded Companion" here - confirmed by the
; userData folder using the same name.
;
; electron-builder's NSIS template calls this macro during uninstall; see
; https://www.electron.build/configuration/nsis#custom-nsis-script.
; An upgrade (a newer installer, or "Update now" in the app) also runs this uninstaller,
; with --updated: keep the entry then, or every update would turn Start with Windows off.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Guilded Companion"
    ; The installer copy electron-builder keeps (see customInstall below).
    RMDir /r "$LOCALAPPDATA\guilded-companion-updater"
  ${endIf}
!macroend

; Runs at the end of every install and update, after the files, registry and shortcuts are
; written and just before the one-click installer starts the app.
!macro customInstall
  ; Start the installed exe itself. electron-builder launches the Start Menu shortcut when the
  ; file exists, but on a fresh PC the shell may not see the new .lnk yet, so Windows showed
  ; "cannot find ...\Guilded Companion.lnk" and the app did not open after install.
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ; electron-builder writes InstallLocation only under its own key; Apps & features reads it here.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  ; electron-builder keeps a full copy of this installer (about 120 MB) for electron-updater's
  ; differential downloads. The companion updates itself with the full installer from GitHub
  ; (update-check.cjs), so the copy is never used: remove it.
  RMDir /r "$LOCALAPPDATA\guilded-companion-updater"
  ; The start the installer launches waits for the old companion to be gone before it reads the
  ; settings (main.cjs, INSTALLER_MARKER), and says in startup.log that the installer started it.
  ClearErrors
  FileOpen $0 "$INSTDIR\launched-by-installer" w
  ${ifNot} ${Errors}
    FileWrite $0 "1"
    FileClose $0
  ${endIf}
!macroend


; Before any file is replaced: the running companion must be fully closed, or the installer replaces
; files under a running app (9.0 release blocker), and must close it by itself: an upgrade while the
; companion runs showed "Guilded Companion cannot be closed" and stopped, and the old way of asking
; it to quit (starting the exe a second time) made an older companion flash its window.
;
; 1. Ask: write quit-for-update in the companion's data folder. A 9.0+ companion watches for it,
;    saves its settings and quits (main.cjs QUIT_REQUEST_FILE). Nothing is started, so nothing flashes.
; 2. Wait up to 15 s for it to go.
; 3. Close what is left: every Guilded Companion of this Windows session, whatever folder it runs
;    from, retried every half second for about 30 s.
; 4. Only then ask the member (Retry starts the 30 s again). A silent update (/S, the companion's
;    own auto-update) cancels instead: the companion stays as it was and tries again later.
;
; Processes are found through PowerShell by name and Windows session (no user-name matching, which
; failed on some PCs), with tasklist as the fallback when PowerShell cannot run.
!searchreplace GUILDED_PROCESS "${APP_EXECUTABLE_FILENAME}" ".exe" ""
!define GUILDED_POWERSHELL `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command`
!define GUILDED_MINE `$$s = (Get-Process -Id $$PID).SessionId; $$p = Get-Process -Name '${GUILDED_PROCESS}' -ErrorAction SilentlyContinue | Where-Object { $$_.SessionId -eq $$s }`
!define GUILDED_TASKLIST `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`

; Sets $R0 to 0 while a companion of this session runs, anything else when none does.
!macro GUILDED_FIND
  nsExec::Exec `${GUILDED_POWERSHELL} "${GUILDED_MINE}; if ($$p) { exit 0 } else { exit 3 }"`
  Pop $R0
  ${if} $R0 != 0
  ${andIf} $R0 != 3
    ; PowerShell did not run (blocked or missing): ask tasklist instead.
    nsExec::Exec `${GUILDED_TASKLIST}`
    Pop $R0
  ${endIf}
!macroend

!macro GUILDED_KILL
  nsExec::Exec `${GUILDED_POWERSHELL} "${GUILDED_MINE}; $$p | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $R2
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $R2
!macroend

!macro customCheckAppRunning
  !insertmacro GUILDED_FIND
  ${if} $R0 == 0
    DetailPrint "$(appClosing)"
    ; 1. The quit request (per-user data folder, the same one the companion uses).
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    ClearErrors
    FileOpen $R3 "$APPDATA\${PRODUCT_NAME}\quit-for-update" w
    ${ifNot} ${Errors}
      FileWrite $R3 "installer"
      FileClose $R3
    ${endIf}
    ; 2. Up to 15 s for it to save and quit.
    StrCpy $R1 0
    guilded_wait_graceful:
      !insertmacro GUILDED_FIND
      ${if} $R0 == 0
      ${andIf} $R1 < 30
        IntOp $R1 $R1 + 1
        Sleep 500
        Goto guilded_wait_graceful
      ${endIf}
    ; 3. Close what is left, about 30 s of tries.
    StrCpy $R1 0
    guilded_kill:
      !insertmacro GUILDED_FIND
      ${if} $R0 == 0
        IntOp $R1 $R1 + 1
        ${if} $R1 > 60
          ; 4. Still running: the member decides (Retry tries again); a silent update cancels.
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY guilded_retry
          Delete "$APPDATA\${PRODUCT_NAME}\quit-for-update"
          Quit
          guilded_retry:
          StrCpy $R1 0
        ${endIf}
        !insertmacro GUILDED_KILL
        Sleep 500
        Goto guilded_kill
      ${endIf}
    ; The request is no longer needed (an older companion never reads it).
    Delete "$APPDATA\${PRODUCT_NAME}\quit-for-update"
    ; Give Windows a moment to release the files.
    Sleep 1000
  ${endIf}
!macroend
