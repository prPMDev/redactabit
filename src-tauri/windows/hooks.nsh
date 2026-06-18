; Frisket NSIS installer hooks.
;
; On a genuine uninstall, delete the WebView2 user-data dir so downloaded GLiNER models (~200 MB),
; run history, and logs don't orphan under %LOCALAPPDATA%\com.frisket.app. Tauri's generated
; uninstaller sets $UpdateMode = 1 when invoked with /UPDATE (an app update runs the old
; uninstaller); guarding on it means updates KEEP the user's downloaded models, only a real
; uninstall wipes them. $UpdateMode is parsed (GetOptions /UPDATE) before this hook runs.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    RMDir /r "$LOCALAPPDATA\com.frisket.app"
  ${EndIf}
!macroend
