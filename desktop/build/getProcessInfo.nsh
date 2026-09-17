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

    System::Call 'kernel32::GetCurrentProcess() i.r1'

    ; Get parent process ID using NtQueryInformationProcess
    ; PROCESS_BASIC_INFORMATION structure:
    ;   NTSTATUS ExitStatus (offset 0, 4 bytes)
    ;   PPEB PebBaseAddress (offset 4, pointer size)
    ;   ULONG_PTR AffinityMask (offset 4+ptr, pointer size)
    ;   KPRIORITY BasePriority (offset 4+2*ptr, 4 bytes)
    ;   ULONG_PTR UniqueProcessId (offset 8+2*ptr, pointer size)
    ;   ULONG_PTR InheritedFromUniqueProcessId (offset 8+3*ptr, pointer size)
    ; On x64: offset of InheritedFromUniqueProcessId = 8 + 3*8 = 32
    ; On x86: offset of InheritedFromUniqueProcessId = 8 + 3*4 = 20
    System::Call '*(&i48) i.r2'  ; Allocate 48 bytes for PROCESS_BASIC_INFORMATION
    System::Call 'ntdll::NtQueryInformationProcess(i r1, i 0, i r2, i 48, *i 0) i.r3'
    ${If} $3 == 0
      ; Success - extract parent PID from offset 32 (x64) or 20 (x86)
      ${If} ${RunningX64}
        System::Call '*$2(i,p,p,i,p,p.r3)'  ; Read InheritedFromUniqueProcessId at offset 32
      ${Else}
        System::Call '*$2(i,i,i,i,i,i.r3)'  ; Read InheritedFromUniqueProcessId at offset 20
      ${EndIf}
      StrCpy ${OutParentPID} $3
    ${Else}
      ; Fallback if NtQueryInformationProcess fails
      StrCpy ${OutParentPID} "$0"
    ${EndIf}
    System::Free $2

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
