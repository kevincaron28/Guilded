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
!macroend
