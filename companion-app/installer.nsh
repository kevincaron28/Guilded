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
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Guilded Companion"
!macroend
