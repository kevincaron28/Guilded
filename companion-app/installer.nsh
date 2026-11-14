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
; Set by the closer below when a companion ran: a manual run then goes without the old uninstaller and
; starts the companion again afterwards.
; Only the installer uses it: an unused variable is a warning, and warnings fail the uninstaller build.
!ifndef BUILD_UNINSTALLER
  !ifndef GUILDED_VARS
    !define GUILDED_VARS
    Var /GLOBAL guildedWasRunning
  !endif
!endif

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
  ; A silent run that closed a running companion starts it again (the app's own update does that itself
  ; with --force-run; an interactive run starts it at the end).
  ${if} $guildedWasRunning == "1"
  ${andIf} ${Silent}
  ${andIfNot} ${isForceRun}
    !insertmacro StartApp
  ${endIf}
!macroend


; Before any file is replaced: the running companion must be fully closed, or the installer replaces
; files under a running app (9.0 release blocker), and must close it by itself: an upgrade while the
; companion runs showed "Guilded Companion cannot be closed" and stopped, and the old way of asking
; it to quit (starting the exe a second time) made an older companion flash its window.
;
; This runs before electron-builder calls the installed version's uninstaller (installSection.nsh runs
; CHECK_APP_RUNNING first), so an upgrade from an older version also benefits: that old uninstaller
; finds nothing left to close.
;
; The test for "closed" is the exe itself: a running program's exe cannot be opened for writing, so
; "can be written" means nothing runs from it. Everything else only helps to get there, and all of it
; is bounded by the clock (every external command has a time limit too):
; 1. Ask: write quit-for-update in the companion's data folder. A 9.0+ companion watches for it,
;    saves its settings and quits (main.cjs QUIT_REQUEST_FILE). Nothing is started, so nothing flashes.
; 2. Wait up to 6 s for it to go.
; 3. Up to 25 s in all: end every Guilded Companion by exe name (taskkill /F /IM by name, never a tree: the
;    companion's own update starts this installer as a child of the app, and a process tree walk
;    would kill the installer too). After 10 s, once, also end whatever runs below the install folder
;    (a helper with another name), by process id with PowerShell; that command skips itself and its
;    parent, the installer.
; 4. Still locked: a silent run (/S) stops with exit code 2 and the old install intact (never a
;    half-replaced one); otherwise the member decides (Retry starts again).
; What was found and ended is written to %TEMP%\guilded-companion-installer.log (ASCII, rewritten on
; every run: process names and ids only, no paths or user names). The member's data folder is only
; touched for the quit-for-update request file, which is removed again.
!searchreplace GUILDED_PROCESS "${APP_EXECUTABLE_FILENAME}" ".exe" ""
!define GUILDED_POWERSHELL `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command`
; $$t = the processes to end by path: anything below GUILDED_INSTDIR\ (trailing backslash, so a sibling folder never matches,
; and nothing matches when the variable is empty), never this PowerShell or its parent (the installer). The folder comes
; through the environment, so a quote in the path (a user name like O'Brien) cannot break the command.
!define GUILDED_TARGETS `$$d = $$env:GUILDED_INSTDIR; if ($$d) { $$d = $$d.TrimEnd('\') + '\' }; $$me = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $$PID)).ParentProcessId; $$t = @(); if ($$d) { $$t = @(Get-CimInstance Win32_Process | Where-Object { $$_.ProcessId -ne $$PID -and $$_.ProcessId -ne $$me -and $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$d, [System.StringComparison]::OrdinalIgnoreCase) }) }`
!define GUILDED_TASKLIST `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`

; Sets $R0 to 0 while a Guilded Companion runs, anything else when none does; $R2 holds the matching lines.
!macro GUILDED_FIND
  nsExec::ExecToStack /TIMEOUT=10000 `${GUILDED_TASKLIST}`
  Pop $R0
  Pop $R2
!macroend

; Sets $R8 to "locked" while the exe cannot be written (it runs), "free" otherwise (also when it is not there).
!macro GUILDED_PROBE
  StrCpy $R8 "free"
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ClearErrors
    FileOpen $R3 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" a
    ${if} ${Errors}
      StrCpy $R8 "locked"
    ${else}
      FileClose $R3
    ${endIf}
  ${endIf}
!macroend

; One round: end every Guilded Companion by exe name, no process tree.
!macro GUILDED_KILL
  nsExec::ExecToStack /TIMEOUT=10000 `"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $R2
  Pop $R2
!macroend

; Once: end what runs below the install folder under any name (not the installer, not its parent), at most 20 s.
!macro GUILDED_PATHKILL
  nsExec::ExecToStack /TIMEOUT=20000 `${GUILDED_POWERSHELL} "${GUILDED_TARGETS}; $$t | ForEach-Object { 'ended: pid ' + $$_.ProcessId + ' ' + [System.IO.Path]::GetFileName($$_.ExecutablePath); Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; exit 0"`
  Pop $R2
  Pop $R2
  !insertmacro GUILDED_LOG "path-based close ran: $R2"
!macroend

; One line in %TEMP%\guilded-companion-installer.log (no paths or user names).
!macro GUILDED_LOG TEXT
  ClearErrors
  FileOpen $R4 "$TEMP\guilded-companion-installer.log" a
  ${ifNot} ${Errors}
    FileSeek $R4 0 END
    !ifdef BUILD_UNINSTALLER
      FileWrite $R4 "[uninstaller] ${TEXT}$\r$\n"
    !else
      FileWrite $R4 "[installer] ${TEXT}$\r$\n"
    !endif
    FileClose $R4
  ${endIf}
!macroend

; Milliseconds since the tick in $R5, into $R6 (wraps correctly).
!macro GUILDED_ELAPSED
  System::Call 'kernel32::GetTickCount()i.R6'
  IntOp $R6 $R6 - $R5
!macroend

!macro customCheckAppRunning
  ; A fresh log for this run (the old uninstaller an installer starts adds its lines after the installer's).
  !ifndef BUILD_UNINSTALLER
    ClearErrors
    FileOpen $R4 "$TEMP\guilded-companion-installer.log" w
    ${ifNot} ${Errors}
      FileClose $R4
    ${endIf}
    StrCpy $guildedWasRunning "0"
  !endif
  ; The install folder for the path-based close, through the environment. Nothing matches by path while it is empty.
  ${if} $INSTDIR != ""
    System::Call 'kernel32::SetEnvironmentVariable(t "GUILDED_INSTDIR", t "$INSTDIR")i.R2'
  ${endIf}
  !insertmacro GUILDED_FIND
  !insertmacro GUILDED_PROBE
  !insertmacro GUILDED_LOG "close check: tasklist=$R0 exe=$R8"
  ${if} $R0 == 0
  ${orIf} $R8 == "locked"
    DetailPrint "$(appClosing)"
    !insertmacro GUILDED_LOG "running: $R2"
    ; 1. The quit request (per-user data folder, the same one the companion uses).
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    ClearErrors
    FileOpen $R3 "$APPDATA\${PRODUCT_NAME}\quit-for-update" w
    ${ifNot} ${Errors}
      FileWrite $R3 "installer"
      FileClose $R3
    ${endIf}
    ; 2. Up to 6 s for it to save and quit.
    System::Call 'kernel32::GetTickCount()i.R5'
    guilded_wait_graceful:
      !insertmacro GUILDED_PROBE
      ${if} $R8 == "locked"
        !insertmacro GUILDED_ELAPSED
        ${if} $R6 < 6000
          Sleep 500
          Goto guilded_wait_graceful
        ${endIf}
      ${endIf}
    guilded_close_round:
    ; 3. End what is left: by exe name every half second, up to 25 s; once after 10 s also by path.
    System::Call 'kernel32::GetTickCount()i.R5'
    StrCpy $R9 "no"
    guilded_kill:
      !insertmacro GUILDED_PROBE
      ${if} $R8 == "locked"
        !insertmacro GUILDED_KILL
        !insertmacro GUILDED_ELAPSED
        ${if} $R6 > 10000
        ${andIf} $R9 == "no"
          StrCpy $R9 "yes"
          !insertmacro GUILDED_PATHKILL
        ${endIf}
        !insertmacro GUILDED_ELAPSED
        ${if} $R6 < 25000
          Sleep 500
          Goto guilded_kill
        ${endIf}
        !insertmacro GUILDED_PROBE
      ${endIf}
    ; 4. Still locked: never go on to a half-replaced install.
    ${if} $R8 == "locked"
      !insertmacro GUILDED_LOG "the exe is still locked after 25 s"
      !insertmacro GUILDED_FIND
      !insertmacro GUILDED_LOG "still running: $R2"
      ${if} ${Silent}
        Delete "$APPDATA\${PRODUCT_NAME}\quit-for-update"
        SetErrorLevel 2
        Quit
      ${endIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY guilded_close_round
      Delete "$APPDATA\${PRODUCT_NAME}\quit-for-update"
      Quit
    ${endIf}
    ; The request is no longer needed (an older companion never reads it).
    Delete "$APPDATA\${PRODUCT_NAME}\quit-for-update"
    !insertmacro GUILDED_LOG "closed; going on"
    !ifndef BUILD_UNINSTALLER
      StrCpy $guildedWasRunning "1"
      ; A manual run (not the app's own update): this installer has closed the companion, so the old version's
      ; uninstaller is not needed and must not be able to stop the install with its own closing check (a manual
      ; install ended with exit code 2 on 13 November). The new files are copied over the old ones and the
      ; uninstall entry is written again by the installer. The app's own update (--updated) keeps the usual path.
      ${ifNot} ${isUpdated}
        DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
        !ifdef UNINSTALL_REGISTRY_KEY_2
          DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
        !endif
        !insertmacro GUILDED_LOG "old uninstaller skipped"
      ${endIf}
    !endif
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
