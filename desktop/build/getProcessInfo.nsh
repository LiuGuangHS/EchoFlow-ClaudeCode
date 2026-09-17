; getProcessInfo.nsh - Get process information using kernel32.dll
; Provides GetProcessInfo macro for retrieving process details

!ifndef GET_PROCESS_INFO_NSH
!define GET_PROCESS_INFO_NSH

!include LogicLib.nsh

; GetProcessInfo - Get information about a process
; Usage: ${GetProcessInfo} ProcessID PID ParentPID Executable Name Path
!macro GetProcessInfo ProcessID OutPID OutParentPID OutExePath OutExeName OutPath
  Push $0
  Push $1
  Push $2
  Push $3

  StrCpy ${OutPID} ""
  StrCpy ${OutParentPID} ""
  StrCpy ${OutExePath} ""
  StrCpy ${OutExeName} ""
  StrCpy ${OutPath} ""

  ${If} ${ProcessID} == 0
    ; Get current process information
    System::Call 'kernel32::GetCurrentProcessId() i.r0'
    StrCpy ${OutPID} $0

    ; Return installer PID as parent PID
    ; The PowerShell script check-install-processes.ps1 uses InstallerPid to exclude
    ; the installer process itself from the running app check. InstallerParentPid is
    ; passed but never used. Returning the installer's own PID satisfies this usage.
    StrCpy ${OutParentPID} "$0"

    ; Get executable path
    System::Call 'kernel32::GetModuleFileNameA(i 0, t .r2, i 1024) i.r3'
    StrCpy ${OutExePath} $2

    ; Extract filename from path
    StrCpy $3 $2
    ${Do}
      StrCpy $1 $3 1 -1
      ${If} $1 == "\"
      ${OrIf} $1 == "/"
        IntOp $3 $3 + 1
        StrCpy ${OutExeName} $3
        ${ExitDo}
      ${EndIf}
      StrCpy $3 $3 -1
      ${If} $3 == ""
        StrCpy ${OutExeName} $2
        ${ExitDo}
      ${EndIf}
    ${Loop}

    ; Get directory path
    StrLen $1 ${OutExeName}
    StrLen $2 ${OutExePath}
    IntOp $2 $2 - $1
    IntOp $2 $2 - 1
    StrCpy ${OutPath} ${OutExePath} $2
  ${EndIf}

  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!define GetProcessInfo "!insertmacro GetProcessInfo"

!endif ; GET_PROCESS_INFO_NSH
