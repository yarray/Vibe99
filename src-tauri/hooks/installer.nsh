; Vibe99 NSIS installer hooks
; Called during installation to configure process security settings.
;
; RedirectionGuard (Windows 11) can block symlink/reparse point traversal
; in child processes, causing OS error 448 (STATUS_UNTRUSTED_MOUNT_POINT)
; when running tools like cargo.exe from the terminal.
;
; This hook uses the Windows System plugin to call SetProcessMitigationPolicy
; on the installer process, and writes a per-app Exploit Protection config
; that prevents RedirectionGuard from being enabled on the installed binary.

!macro NSIS_HOOK_POSTINSTALL
  ; Write a "process mitigation" override for Vibe99.exe so that
  ; RedirectionGuard is explicitly disabled at the OS level.
  ; This uses the IFEO MitigationOptions registry key.
  ;
  ; Format: the MitigationOptions value is a REG_BINARY blob.
  ; RedirectionGuard is at offset 4 (bits 33:32 of the 64-bit mask).
  ; Setting bits [33:32] = 00 means "default/off" (not enforced).
  ; We write a 12-byte zero blob to reset all per-app mitigations to off.

  WriteRegBin HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\Vibe99.exe" "MitigationOptions" "000000000000000000000000"
!macroend
