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

; Before any file is replaced (9.0 release blocker): the old companion must be fully closed, or the
; installer replaces files under a running app and the new version may start while the old one
; still holds them. electron-builder's own check only finds processes whose path starts with
; $INSTDIR; this one finds every Guilded Companion of this user by name, and waits until none is left.
!define GUILDED_FIND_RUNNING `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
!macro customCheckAppRunning
  nsExec::Exec `${GUILDED_FIND_RUNNING}`
  Pop $R0
  ${if} $R0 == 0
    DetailPrint "$(appClosing)"
    ; 1. A 9.0+ companion quits cleanly when asked (it saves its settings first). An older one only
    ;    shows its window; step 2 closes it. Run only while one is running: this second launch
    ;    hands the request to it and exits at once.
    ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit-for-update'
    ${endIf}
    StrCpy $R1 0
    guilded_wait_graceful:
      nsExec::Exec `${GUILDED_FIND_RUNNING}`
      Pop $R0
      ${if} $R0 == 0
      ${andIf} $R1 < 30
        IntOp $R1 $R1 + 1
        Sleep 500
        Goto guilded_wait_graceful
      ${endIf}
    ; 2. Close whatever is left, in any folder, and wait until nothing is running.
    StrCpy $R1 0
    guilded_kill:
      nsExec::Exec `${GUILDED_FIND_RUNNING}`
      Pop $R0
      ${if} $R0 == 0
        IntOp $R1 $R1 + 1
        ${if} $R1 > 20
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY guilded_retry
          Quit
          guilded_retry:
          StrCpy $R1 0
        ${endIf}
        nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
        Pop $R0
        Sleep 500
        Goto guilded_kill
      ${endIf}
    ; Give Windows a moment to release the files.
    Sleep 1000
  ${endIf}
!macroend
