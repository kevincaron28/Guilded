; Extra uninstall cleanup for Guilded Companion.
;
; "deleteAppDataOnUninstall" is off (package.json): since 9.1.3 an uninstall keeps
; %APPDATA%\Guilded Companion (settings, Discord sign-in) unless the member says yes below.
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
    ; Electron writes its Start with Windows entry under "electron.app.<productName>" (9.1.3: this was left behind).
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.${PRODUCT_NAME}"
    ; The member's settings stay unless they say otherwise; a silent uninstall never asks and never deletes.
    ${if} ${Silent}
      DetailPrint "Settings kept."
    ${else}
      ${if} $LANGUAGE == 1036
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Supprimer aussi vos réglages et votre connexion Discord ? Choisissez Non pour les garder (utile avant une réinstallation)." /SD IDNO IDNO guilded_keep_data
      ${else}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your settings and Discord sign-in? Choose No to keep them (useful before a reinstall)." /SD IDNO IDNO guilded_keep_data
      ${endIf}
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
      guilded_keep_data:
    ${endIf}
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
; 2. Wait a few seconds (6 tries) for it to go.
; 3. Close what is left: every Guilded Companion of this Windows session, whatever folder it runs
;    from, its whole process tree, retried every half second for about 30 s.
; 4. Wait until the exe can be written (the files are free), up to 20 s.
; 5. Only then ask the member (Retry starts the 30 s again). A silent run (/S) never asks and never
;    hangs: it goes on after one last attempt, and the file copy has its own retries.
; Every step is written to %TEMP%\guilded-companion-installer.log (process ids, paths, what was
; killed), so a failed update can be read afterwards. The member's data folder is never touched
; except for the one quit-for-update request file, which is removed again.
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
  ; The whole tree by name (Electron's helpers and children), then everything that runs from the
  ; install folder, whatever it is called (a helper started from this exe).
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $R2
  nsExec::Exec `${GUILDED_POWERSHELL} "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) -and $$_.ProcessId -ne $$PID } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $R2
!macroend

; One line in %TEMP%\guilded-companion-installer.log.
!macro GUILDED_LOG TEXT
  ClearErrors
  FileOpen $R4 "$TEMP\guilded-companion-installer.log" a
  ${ifNot} ${Errors}
    FileSeek $R4 0 END
    FileWrite $R4 "${TEXT}$\r$\n"
    FileClose $R4
  ${endIf}
!macroend

; Who runs, with process id, parent, Windows session and path, into the same log.
!macro GUILDED_LIST
  nsExec::Exec `${GUILDED_POWERSHELL} "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' } | ForEach-Object { 'running: pid ' + $$_.ProcessId + ' parent ' + $$_.ParentProcessId + ' session ' + $$_.SessionId + ' ' + $$_.ExecutablePath } | Add-Content -Path '$TEMP\guilded-companion-installer.log'"`
  Pop $R2
!macroend

!macro customCheckAppRunning
  !insertmacro GUILDED_FIND
  !insertmacro GUILDED_LOG "close check: running=$R0 dir=$INSTDIR"
  ${if} $R0 == 0
    DetailPrint "$(appClosing)"
    !insertmacro GUILDED_LIST
    ; 1. The quit request (per-user data folder, the same one the companion uses).
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    ClearErrors
    FileOpen $R3 "$APPDATA\${PRODUCT_NAME}\quit-for-update" w
    ${ifNot} ${Errors}
      FileWrite $R3 "installer"
      FileClose $R3
    ${endIf}
    ; 2. A few seconds for it to save and quit.
    StrCpy $R1 0
    guilded_wait_graceful:
      !insertmacro GUILDED_FIND
      ${if} $R0 == 0
      ${andIf} $R1 < 6
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
          !insertmacro GUILDED_LOG "still running after the kill attempts"
          !insertmacro GUILDED_LIST
          ; 5. Still running. A silent run (/S) never asks and never hangs: it goes on. The member is asked
          ;    (Retry tries again, Cancel stops the install).
          ${if} ${Silent}
            Goto guilded_go_on
          ${endIf}
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
    !insertmacro GUILDED_LOG "kill rounds: $R1"
    guilded_go_on:
    ; The request is no longer needed (an older companion never reads it).
    Delete "$APPDATA\${PRODUCT_NAME}\quit-for-update"
    ; 4. Wait until the exe can be written: a process that is gone can still hold it for a moment.
    StrCpy $R1 0
    guilded_wait_files:
      ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        ClearErrors
        FileOpen $R3 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" a
        ${ifNot} ${Errors}
          FileClose $R3
        ${else}
          IntOp $R1 $R1 + 1
          ${if} $R1 < 40
            Sleep 500
            Goto guilded_wait_files
          ${endIf}
          !insertmacro GUILDED_LOG "the exe is still locked after 20 s"
        ${endIf}
      ${endIf}
    !insertmacro GUILDED_LOG "closed; going on"
    ; Give Windows a moment to release the files.
    Sleep 1000
  ${endIf}
  ; Then the Microsoft Store version, if any (it was closed above too: same exe name).
  !insertmacro GUILDED_REPLACE_STORE
!macroend

; Replace a Microsoft Store Guilded Companion with this one (owner, 7 November 2026: "when we install
; the companion it uninstalls other versions"). replace-store.ps1 moves the Store version's settings
; and Discord link into this version's folder, then removes the Store package. Only the installer
; does this (never the uninstaller), after the running companion is closed and before any file is
; copied. Older direct-download installs are replaced by electron-builder's own upgrade step.
!macro GUILDED_REPLACE_STORE
  !ifndef BUILD_UNINSTALLER
    File "/oname=$PLUGINSDIR\guilded-replace-store.ps1" "${PROJECT_DIR}\replace-store.ps1"
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\guilded-replace-store.ps1"`
    Pop $R0
    ${if} $R0 == 10
    ${orIf} $R0 == 11
      ${if} $LANGUAGE == 1036
        MessageBox MB_OK|MB_ICONINFORMATION "La version Microsoft Store de Guilded Companion a été remplacée par celle-ci, qui se met à jour toute seule. Vos réglages et votre liaison Discord sont conservés." /SD IDOK
      ${else}
        MessageBox MB_OK|MB_ICONINFORMATION "The Microsoft Store version of Guilded Companion was replaced by this one, which updates itself. Your settings and Discord link are kept." /SD IDOK
      ${endIf}
      DetailPrint "Microsoft Store version replaced ($R0)."
    ${elseIf} $R0 == 20
      ${if} $LANGUAGE == 1036
        MessageBox MB_OK|MB_ICONEXCLAMATION "La version Microsoft Store de Guilded Companion est aussi installée et n'a pas pu être retirée. Après l'installation, retirez-la dans Paramètres Windows > Applications pour n'en garder qu'une." /SD IDOK
      ${else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "The Microsoft Store version of Guilded Companion is also installed and could not be removed. After this install, remove it in Windows Settings > Apps so only one is left." /SD IDOK
      ${endIf}
    ${endIf}
  !endif
!macroend
