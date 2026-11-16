!include "${__FILEDIR__}/../build/product-identity.generated.nsh"

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running EchoFlow Code sidecars..."
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping running EchoFlow Code processes..."
  nsExec::ExecToLog 'taskkill /F /T /IM ${ECHOFLOW_PRODUCT_SLUG}.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM claude-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend
