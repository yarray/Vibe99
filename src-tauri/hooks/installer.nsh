; Vibe99 NSIS installer hooks
;
; Two jobs at install time:
;
; 1. RedirectionGuard (Windows 11) can block symlink/reparse point traversal in
;    child processes, causing OS error 448 (STATUS_UNTRUSTED_MOUNT_POINT) when
;    running tools like cargo.exe from the terminal. A per-app Exploit
;    Protection override (IFEO MitigationOptions) disables it for Vibe99.exe.
;
; 2. tauri bundles `vibe99ctl.exe` next to `Vibe99.exe`, but the install
;    directory is not on PATH, so `vibe99ctl` is invisible from a new shell.
;    The installer asks the CLI to install itself (`install-cli`), the same
;    code path users run by hand: it copies the binary to
;    `%USERPROFILE%\.local\bin` and appends that directory to the user PATH.
;
;    Doing it that way keeps one implementation of the registry edit. The Rust
;    side uses winreg and handles REG_EXPAND_SZ, case-insensitive
;    de-duplication and values of any length; the NSIS equivalent would have
;    to re-implement all of that inside a string capped by NSIS_MAX_STRLEN
;    (1024 by default), where a long PATH is silently truncated.

; The tauri template pulls LogicLib in via StrFunc.nsh; include it here too so
; the macros below do not depend on that transitive include.
!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegBin HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\Vibe99.exe" "MitigationOptions" "000000000000000000000000"

  ; No console window: nsExec runs the CLI hidden and logs its output to the
  ; installer's detail pane.
  ${IfNot} ${FileExists} "$INSTDIR\vibe99ctl.exe"
    DetailPrint "vibe99ctl.exe is missing from $INSTDIR; skipping the PATH setup."
  ${Else}
    nsExec::ExecToLog '"$INSTDIR\vibe99ctl.exe" install-cli'
    Pop $0
    ${If} $0 != 0
      ; A silent install has nobody to read a dialog, so it gets the log line
      ; only. An interactive one is told, because "the CLI is on PATH" is part
      ; of what installing promises.
      ${IfNot} ${Silent}
        MessageBox MB_ICONEXCLAMATION|MB_OK "vibe99ctl could not be added to your PATH (exit $0).$\r$\n$\r$\nOpen a terminal and run:$\r$\n    $\"$INSTDIR\vibe99ctl.exe$\" install-cli"
      ${EndIf}
      DetailPrint "Could not add vibe99ctl to PATH (exit $0). Run $\"$INSTDIR\vibe99ctl.exe$\" install-cli to retry."
    ${Else}
      ; Explorer caches the environment it hands to new processes. Without this
      ; broadcast a terminal opened right after installing still has the old
      ; PATH; with it, Explorer re-reads the registry and the next terminal
      ; sees vibe99ctl without a sign-out.
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove only the copy `install-cli` made for this user. The PATH entry is
  ; left alone on purpose: `%USERPROFILE%\.local\bin` is shared with other
  ; tools (uv, pipx), so deleting the entry would break them, and rewriting
  ; the value to drop one element risks truncating a long PATH. A dangling
  ; directory on PATH is harmless.
  Delete "$PROFILE\.local\bin\vibe99ctl.exe"
!macroend
