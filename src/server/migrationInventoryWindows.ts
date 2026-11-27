import { execFile } from 'node:child_process'
import { gzipSync } from 'node:zlib'

const maxOutput = 8 * 1024 * 1024
const maxProcesses = 32_768
const unavailable = (): Error => new Error('Storage migration blocked: Windows native inventory unavailable')
const incomplete = (): Error => new Error('Storage migration blocked: Windows native per-PID completeness evidence is required')

export type WindowsInventoryRequest = {
  version: 1
  roots: readonly string[]
  ownedPids: readonly number[]
  ownerPatterns: readonly string[]
}
export type WindowsInventoryRunner = (input: string) => Promise<{ stdout: string; stderr: string; pid?: number }>

/** Fixed code only; roots, PIDs and the product's fixed patterns travel on stdin. */
export function createWindowsInventoryRunner(execute: typeof execFile = execFile): WindowsInventoryRunner {
  return input => new Promise((resolve, reject) => {
    let child: ReturnType<typeof execFile>
    try {
      // Compression keeps the fixed Add-Type source below CreateProcess's 32K
      // command-line limit; selected roots remain exclusively JSON on stdin.
      const bootstrap = `$r=[IO.StreamReader]::new([IO.Compression.GzipStream]::new([IO.MemoryStream]::new([Convert]::FromBase64String('${gzipSync(inspectorScript).toString('base64')}')),[IO.Compression.CompressionMode]::Decompress),[Text.Encoding]::UTF8); try { & ([scriptblock]::Create($r.ReadToEnd())) } finally { $r.Dispose() }`
      const encoded = Buffer.from(bootstrap, 'utf16le').toString('base64')
      if (encoded.length > 30_000) { reject(unavailable()); return }
      child = execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: maxOutput,
      }, (error, stdout, stderr) => {
        if (error) reject(unavailable())
        else resolve({ stdout: String(stdout), stderr: String(stderr), pid: child.pid })
      })
      child.stdin?.once('error', () => reject(unavailable()))
      if (!child.stdin) { reject(unavailable()); return }
      child.stdin.end(input, 'utf8')
    } catch { reject(unavailable()) }
  })
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw incomplete()
  return value as Record<string, unknown>
}
function array(value: unknown, limit = maxProcesses): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw incomplete()
  return value
}
const validPid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0xffff_ffff
const validTime = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 0x7fff_ffff_ffff_ffffn
const validSid = (value: unknown): value is string => typeof value === 'string' && /^S-1-\d+(?:-\d+){1,15}$/.test(value) && value.length < 192
function snapshot(value: unknown): Map<number, { created: string; sid: string }> {
  const rows = new Map<number, { created: string; sid: string }>()
  for (const entry of array(value)) {
    const row = object(entry, ['pid', 'created', 'sid'])
    if (!validPid(row.pid) || !validTime(row.created) || !validSid(row.sid) || rows.has(row.pid)) throw incomplete()
    rows.set(row.pid, { created: row.created, sid: row.sid })
  }
  if (!rows.size) throw incomplete()
  return rows
}

/** Validates the entire receipt, not just its owner list. Fixture validation is
 * deliberately separate from permission to proceed on an unqualified platform. */
export function validateWindowsInventory(output: string, request: WindowsInventoryRequest, inspectorPid: number | undefined): void {
  if (Buffer.byteLength(output, 'utf8') > maxOutput) throw incomplete()
  let evidence: Record<string, unknown>
  try { evidence = object(JSON.parse(output), ['version', 'architecture', 'currentSid', 'inspectorPid', 'roots', 'before', 'after', 'processes', 'owners', 'error']) } catch { throw incomplete() }
  if (evidence.version !== 1 || evidence.architecture !== 'x64' || evidence.error !== null || !validSid(evidence.currentSid) ||
    !validPid(inspectorPid) || evidence.inspectorPid !== inspectorPid || request.ownedPids.includes(inspectorPid)) throw incomplete()
  const roots = array(evidence.roots, 64)
  if (!request.roots.length || roots.length !== request.roots.length) throw incomplete()
  for (let index = 0; index < roots.length; index++) {
    const root = object(roots[index], ['index', 'requested', 'before', 'after', 'complete', 'error'])
    // Only local disk NT names are supported. Native resolution follows root
    // reparse/short/SUBST aliases; unresolved or nested reparses block natively.
    if (root.index !== index || root.requested !== request.roots[index] || root.complete !== true || root.error !== null || typeof root.before !== 'string' ||
      root.before.length > 32_768 || !/^\\Device\\HarddiskVolume[^\\]*\\[^\0]*$/i.test(root.before) || root.before !== root.after) throw incomplete()
  }
  const before = snapshot(evidence.before)
  const after = snapshot(evidence.after)
  if (before.size !== after.size) throw incomplete()
  for (const [pid, identity] of before) {
    const end = after.get(pid)
    if (!end || identity.created !== end.created || identity.sid !== end.sid) throw incomplete()
  }
  if (before.get(inspectorPid)?.sid !== evidence.currentSid || request.ownedPids.some(pid => !validPid(pid) || before.get(pid)?.sid !== evidence.currentSid)) throw incomplete()
  const seen = new Set<number>()
  const expectedOwners = new Set<string>()
  let applicationPid: number | undefined
  for (const entry of array(evidence.processes)) {
    const row = object(entry, ['pid', 'created', 'sid', 'applicationOwner', 'handles', 'maps'])
    if (!validPid(row.pid) || seen.has(row.pid)) throw incomplete()
    seen.add(row.pid)
    const identity = before.get(row.pid)
    if (!identity || row.created !== identity.created || row.sid !== identity.sid || typeof row.applicationOwner !== 'boolean') throw incomplete()
    const skip = row.pid === inspectorPid ? 'inspector' : request.ownedPids.includes(row.pid) ? 'owned' : identity.sid !== evidence.currentSid ? 'foreign-user' : null
    if (skip && row.applicationOwner) throw incomplete()
    if (!skip && row.applicationOwner) applicationPid ??= row.pid
    for (const kind of ['handles', 'maps'] as const) {
      const section = object(row[kind], ['complete', 'error', 'roots'])
      const references = array(section.roots, request.roots.length)
      if (new Set(references).size !== references.length || references.some(root => typeof root !== 'number' || !Number.isInteger(root) || root < 0 || root >= request.roots.length)) throw incomplete()
      if (skip ? section.complete !== false || section.error !== skip || references.length !== 0 : section.complete !== true || section.error !== null) throw incomplete()
      for (const root of references) expectedOwners.add(`${row.pid}:${kind}:${root}`)
    }
  }
  if (seen.size !== before.size) throw incomplete()
  const actualOwners = new Set<string>()
  for (const entry of array(evidence.owners, maxProcesses * request.roots.length * 2)) {
    const owner = object(entry, ['pid', 'kind', 'root'])
    if (!validPid(owner.pid) || !['handles', 'maps'].includes(String(owner.kind)) || typeof owner.root !== 'number' || !Number.isInteger(owner.root)) throw incomplete()
    const key = `${owner.pid}:${owner.kind}:${owner.root}`
    if (!expectedOwners.has(key) || actualOwners.has(key)) throw incomplete()
    actualOwners.add(key)
  }
  if (actualOwners.size !== expectedOwners.size) throw incomplete()
  if (applicationPid !== undefined) throw new Error(`Storage migration blocked: application process ${applicationPid} must exit before migration`)
  if (actualOwners.size) throw new Error('Storage migration blocked: a Windows process holds selected storage')
}

export async function assertWindowsMigrationInventory(request: WindowsInventoryRequest, run?: WindowsInventoryRunner): Promise<void> {
  if (!run) throw incomplete()
  if (request.version !== 1 || !request.roots.length || request.roots.length > 64 || request.roots.some(root => !root || root.length > 32_768 || root.includes('\0')) ||
    !request.ownedPids.length || request.ownedPids.some(pid => !validPid(pid)) || request.ownerPatterns.length > 8) throw incomplete()
  const input = JSON.stringify(request)
  if (Buffer.byteLength(input) > 1_048_576) throw incomplete()
  let result: Awaited<ReturnType<WindowsInventoryRunner>>
  try { result = await run(input) } catch { throw unavailable() }
  if (typeof result?.stdout !== 'string' || typeof result.stderr !== 'string' || result.stderr.trim()) throw unavailable()
  validateWindowsInventory(result.stdout, request, result.pid)
  // shortcut: native behavior is not Windows-qualified, retain the barrier until
  // real handle/map/alias and inaccessible-identity fixtures establish completeness.
  throw new Error('Storage migration blocked: Windows native per-PID inspector is not platform-qualified; Windows handle, mapped-file, alias and foreign-identity evidence is required')
}

// No target process is stopped, suspended, injected into, or read for contents.
// Access is limited to identity, image/command metadata, handle names and virtual
// mapping metadata. No environment/PEB reads, privilege changes or root writes.
const inspectorScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false, $true), $false)
  try { $inputText = $reader.ReadToEnd() } finally { $reader.Dispose() }
  if ($inputText.Length -gt 1048576) { throw 'input-limit' }
  $request = ConvertFrom-Json -InputObject $inputText
  if ($request.version -ne 1) { throw 'protocol' }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
public static class EchoFlowMigrationInspector {
  public class Identity { public int pid; public string created; public string sid; }
  public class Section { public bool complete; public string error; public List<int> roots = new List<int>(); }
  public class ProcessRow { public int pid; public string created; public string sid; public bool applicationOwner; public Section handles; public Section maps; }
  public class Root { public int index; public string requested; public string before; public string after; public bool complete; public string error; }
  public class Owner { public int pid; public string kind; public int root; }
  public class Receipt {
    public int version = 1; public string architecture = "unknown"; public string currentSid; public int inspectorPid;
    public List<Root> roots = new List<Root>(); public List<Identity> before = new List<Identity>(); public List<Identity> after = new List<Identity>();
    public List<ProcessRow> processes = new List<ProcessRow>(); public List<Owner> owners = new List<Owner>(); public string error;
  }
  [StructLayout(LayoutKind.Sequential)] struct MemoryRegion {
    public IntPtr address, allocation; public uint allocationProtect, padding; public UIntPtr size; public uint state, protect, type, padding2;
  }
  [StructLayout(LayoutKind.Sequential)] struct SystemInfo {
    public ushort architecture, reserved; public uint pageSize; public IntPtr minimum, maximum, mask; public uint processors, processorType, granularity; public ushort level, revision;
  }
  [StructLayout(LayoutKind.Sequential)] struct FileStandard { public long allocated, length; public uint links; public byte deleted, directory; }
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int kind, IntPtr buffer, int length, out int needed);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int kind, IntPtr buffer, int length, out int needed);
  [DllImport("ntdll.dll")] static extern int NtQueryObject(IntPtr handle, int kind, IntPtr buffer, int length, out int needed);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern int GetCurrentProcessId();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out long created, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsWow64Process2(IntPtr process, out ushort machine, out ushort nativeMachine);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr buffer, int length, out int needed);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr source, IntPtr handle, IntPtr target, out IntPtr copy, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder name, uint length, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetFileType(IntPtr file);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandleEx(IntPtr file, int kind, out FileStandard info, uint length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern UIntPtr VirtualQueryEx(IntPtr process, IntPtr address, out MemoryRegion info, UIntPtr length);
  [DllImport("psapi.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetMappedFileName(IntPtr process, IntPtr address, StringBuilder name, uint length);
  [DllImport("kernel32.dll")] static extern void GetNativeSystemInfo(out SystemInfo info);
  const int Limit = 32 * 1024 * 1024;
  static Stopwatch clock;
  static void Bound() { if (clock.ElapsedMilliseconds > 10000) throw new InvalidOperationException(); }
  static IntPtr BufferQuery(Func<IntPtr, int, int[]> query, out int length) {
    length = 65536;
    for (int attempt = 0; attempt < 10; attempt++) {
      Bound(); IntPtr buffer = Marshal.AllocHGlobal(length);
      int[] result = query(buffer, length);
      if (result[0] == 0) return buffer;
      Marshal.FreeHGlobal(buffer);
      if (result[0] != unchecked((int)0xC0000004) && result[0] != unchecked((int)0xC0000023)) throw new InvalidOperationException();
      length = Math.Max(length * 2, result[1]);
      if (length > Limit) throw new InvalidOperationException();
    }
    throw new InvalidOperationException();
  }
  static string Unicode(IntPtr buffer, int length) {
    int chars = (ushort)Marshal.ReadInt16(buffer);
    IntPtr text = Marshal.ReadIntPtr(buffer, 8);
    long offset = text.ToInt64() - buffer.ToInt64();
    if (chars % 2 != 0 || chars > 65534 || offset < 0 || offset + chars > length) throw new InvalidOperationException();
    return Marshal.PtrToStringUni(text, chars / 2);
  }
  static string Sid(IntPtr process, string expectedTime) {
    long created, exit, kernel, user;
    if (!GetProcessTimes(process, out created, out exit, out kernel, out user) || created.ToString(CultureInfo.InvariantCulture) != expectedTime) throw new InvalidOperationException();
    IntPtr token;
    if (!OpenProcessToken(process, 8, out token)) throw new InvalidOperationException();
    try {
      int needed; GetTokenInformation(token, 1, IntPtr.Zero, 0, out needed);
      if (needed <= 0 || needed > 65536) throw new InvalidOperationException();
      IntPtr buffer = Marshal.AllocHGlobal(needed);
      try {
        if (!GetTokenInformation(token, 1, buffer, needed, out needed)) throw new InvalidOperationException();
        return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
      } finally { Marshal.FreeHGlobal(buffer); }
    } finally { CloseHandle(token); }
  }
  static List<Identity> Snapshot() {
    int length;
    IntPtr buffer = BufferQuery(delegate(IntPtr p, int n) { int needed; int status = NtQuerySystemInformation(5, p, n, out needed); return new int[] {status, needed}; }, out length);
    try {
      List<Identity> rows = new List<Identity>(); HashSet<int> seen = new HashSet<int>(); int offset = 0;
      for (;;) {
        Bound(); if (offset < 0 || offset + 104 > length || rows.Count >= 32768) throw new InvalidOperationException();
        IntPtr p = IntPtr.Add(buffer, offset); int next = Marshal.ReadInt32(p); long id = Marshal.ReadIntPtr(p, 80).ToInt64();
        // PID 0 is the kernel's idle accounting entry, not a user process.
        if (id != 0) {
          if (id < 1 || id > Int32.MaxValue || !seen.Add((int)id)) throw new InvalidOperationException();
          Identity row = new Identity(); row.pid = (int)id; row.created = Marshal.ReadInt64(p, 32).ToString(CultureInfo.InvariantCulture);
          IntPtr process = OpenProcess(0x1000, false, row.pid);
          try { if (process != IntPtr.Zero) row.sid = Sid(process, row.created); } catch { row.sid = null; }
          finally { if (process != IntPtr.Zero) CloseHandle(process); }
          rows.Add(row);
        }
        if (next == 0) break;
        if (next < 104 || next % 8 != 0 || next > length - offset) throw new InvalidOperationException();
        offset += next;
      }
      return rows;
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  static string FinalName(IntPtr handle) {
    StringBuilder text = new StringBuilder(32768); uint count = GetFinalPathNameByHandle(handle, text, (uint)text.Capacity, 2);
    if (count == 0 || count >= text.Capacity || !text.ToString().StartsWith(@"\Device\HarddiskVolume", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException();
    return text.ToString().TrimEnd('\\');
  }
  static IntPtr OpenName(string name) {
    IntPtr handle = CreateFile(name, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (handle == new IntPtr(-1)) throw new InvalidOperationException();
    return handle;
  }
  static string RootName(string input) {
    if (input.Length > 32768 || input.IndexOf('\0') >= 0 || !Path.IsPathRooted(input) || (!Regex.IsMatch(input, @"^(?:[a-z]:\\|\\\\\?\\[a-z]:\\)", RegexOptions.IgnoreCase))) throw new InvalidOperationException();
    string current = Path.GetFullPath(input); List<string> missing = new List<string>();
    for (;;) {
      Bound(); IntPtr handle = CreateFile(current, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
      if (handle != new IntPtr(-1)) {
        try { string name = FinalName(handle); foreach (string part in missing) name += @"\" + part; return name; }
        finally { CloseHandle(handle); }
      }
      int error = Marshal.GetLastWin32Error();
      if (error != 2 && error != 3) throw new InvalidOperationException();
      string parent = Path.GetDirectoryName(current.TrimEnd('\\'));
      if (String.IsNullOrEmpty(parent) || parent == current) throw new InvalidOperationException();
      missing.Insert(0, Path.GetFileName(current)); current = parent;
    }
  }
  static void RejectNestedReparse(string root) {
    // Directory/File.Exists suppress access errors; use attributes instead.
    FileAttributes attributes;
    try { attributes = File.GetAttributes(root); } catch (FileNotFoundException) { return; } catch (DirectoryNotFoundException) { return; }
    if ((attributes & FileAttributes.Directory) == 0) throw new InvalidOperationException();
    Stack<string> pending = new Stack<string>(); pending.Push(root); int entries = 0;
    while (pending.Count != 0) {
      Bound(); foreach (string name in Directory.EnumerateFileSystemEntries(pending.Pop())) {
        Bound(); if (++entries > 100000) throw new InvalidOperationException();
        FileAttributes attr = File.GetAttributes(name);
        if ((attr & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
        if ((attr & FileAttributes.Directory) != 0) pending.Push(name);
      }
    }
  }
  static void Match(string name, List<Root> roots, Section section) {
    for (int i = 0; i < roots.Count; i++) {
      string root = roots[i].before;
      if ((String.Equals(name, root, StringComparison.OrdinalIgnoreCase) || name.StartsWith(root + @"\", StringComparison.OrdinalIgnoreCase)) && !section.roots.Contains(i)) section.roots.Add(i);
    }
  }
  static string DiskName(IntPtr handle) {
    if (GetFileType(handle) != 1) throw new InvalidOperationException();
    FileStandard info;
    if (!GetFileInformationByHandleEx(handle, 1, out info, (uint)Marshal.SizeOf(typeof(FileStandard))) || info.deleted != 0 || (info.directory == 0 && info.links != 1)) throw new InvalidOperationException();
    return FinalName(handle);
  }
  static Dictionary<long, uint> HandleSnapshot(IntPtr process) {
    int length;
    IntPtr buffer = BufferQuery(delegate(IntPtr p, int n) { int needed; int status = NtQueryInformationProcess(process, 51, p, n, out needed); return new int[] {status, needed}; }, out length);
    try {
      long count = Marshal.ReadIntPtr(buffer).ToInt64();
      if (count < 0 || count > 262144 || count * 40 + 16 > length) throw new InvalidOperationException();
      Dictionary<long, uint> handles = new Dictionary<long, uint>();
      for (int i = 0; i < count; i++) {
        IntPtr entry = IntPtr.Add(buffer, 16 + i * 40); long value = Marshal.ReadIntPtr(entry).ToInt64();
        handles.Add(value, unchecked((uint)Marshal.ReadInt32(entry, 28)));
      }
      return handles;
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  static Section Handles(IntPtr process, List<Root> roots) {
    Section result = new Section();
    try {
      Dictionary<long, uint> handles = HandleSnapshot(process);
      foreach (KeyValuePair<long, uint> entry in handles) {
        Bound(); IntPtr copy;
        if (!DuplicateHandle(process, new IntPtr(entry.Key), GetCurrentProcess(), out copy, 0, false, 2)) throw new InvalidOperationException();
        try {
          int length;
          IntPtr buffer = BufferQuery(delegate(IntPtr p, int n) { int needed; int status = NtQueryObject(copy, 2, p, n, out needed); return new int[] {status, needed}; }, out length);
          string type;
          try { type = Unicode(buffer, length); } finally { Marshal.FreeHGlobal(buffer); }
          if (type == "File") {
            uint fileType = GetFileType(copy);
            if (fileType == 1) Match(DiskName(copy), roots, result);
            else if (fileType != 2 && fileType != 3) throw new InvalidOperationException();
          }
        } finally { CloseHandle(copy); }
      }
      Dictionary<long, uint> after = HandleSnapshot(process);
      if (handles.Count != after.Count) throw new InvalidOperationException();
      foreach (KeyValuePair<long, uint> entry in handles) { uint value; if (!after.TryGetValue(entry.Key, out value) || value != entry.Value) throw new InvalidOperationException(); }
      result.complete = true;
    } catch { result.error = "handles-incomplete"; }
    return result;
  }
  static List<string> MapSnapshot(IntPtr process, List<Root> roots, Section section) {
    SystemInfo system; GetNativeSystemInfo(out system); ulong maximum = (ulong)system.maximum.ToInt64(); ulong address = 0; int regions = 0;
    List<string> receipt = new List<string>();
    while (address <= maximum) {
      Bound(); if (++regions > 1000000) throw new InvalidOperationException();
      MemoryRegion info;
      if (VirtualQueryEx(process, new IntPtr((long)address), out info, new UIntPtr((uint)Marshal.SizeOf(typeof(MemoryRegion)))).ToUInt64() != (ulong)Marshal.SizeOf(typeof(MemoryRegion))) throw new InvalidOperationException();
      ulong size = info.size.ToUInt64(); if ((ulong)info.address.ToInt64() != address || size == 0 || size > UInt64.MaxValue - address) throw new InvalidOperationException();
      if (info.state != 0x10000 && info.state != 0x1000 && info.state != 0x2000) throw new InvalidOperationException();
      if (info.type == 0x40000 || info.type == 0x1000000) {
        StringBuilder path = new StringBuilder(32768); uint count = GetMappedFileName(process, info.address, path, (uint)path.Capacity);
        if (count == 0 || count >= path.Capacity || !path.ToString().StartsWith(@"\Device\HarddiskVolume", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException();
        IntPtr file = OpenName(@"\\?\GLOBALROOT" + path.ToString()); string name;
        try { name = DiskName(file); } finally { CloseHandle(file); }
        Match(name, roots, section);
        receipt.Add(address.ToString() + ":" + size.ToString() + ":" + info.state.ToString() + ":" + info.protect.ToString() + ":" + name);
      } else if (info.state != 0x10000 && info.type != 0x20000) throw new InvalidOperationException();
      address += size;
    }
    return receipt;
  }
  static Section Maps(IntPtr process, List<Root> roots) {
    Section result = new Section();
    try {
      List<string> before = MapSnapshot(process, roots, result); List<string> after = MapSnapshot(process, roots, new Section());
      if (before.Count != after.Count) throw new InvalidOperationException();
      for (int i = 0; i < before.Count; i++) if (before[i] != after[i]) throw new InvalidOperationException();
      result.complete = true;
    } catch { result.error = "maps-incomplete"; }
    return result;
  }
  static bool Application(IntPtr process, string[] patterns, string[] roots) {
    int length = 32768; StringBuilder image = new StringBuilder(length);
    if (!QueryFullProcessImageName(process, 0, image, ref length)) throw new InvalidOperationException();
    int bytes;
    IntPtr buffer = BufferQuery(delegate(IntPtr p, int n) { int needed; int status = NtQueryInformationProcess(process, 60, p, n, out needed); return new int[] {status, needed}; }, out bytes);
    string command;
    try { command = Unicode(buffer, bytes); } finally { Marshal.FreeHGlobal(buffer); }
    string identity = image.ToString() + "\0" + command;
    foreach (string pattern in patterns) if (Regex.IsMatch(identity, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100))) return true;
    foreach (string root in roots) if (Regex.IsMatch(command, "(?:^|[=\\s\\x00\"'])" + Regex.Escape(root) + "(?=$|[/\\\\\\s\\x00\"'])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100))) return true;
    return false;
  }
  static Section Skip(string reason) { Section result = new Section(); result.error = reason; return result; }
  public static Receipt Inspect(string[] roots, int[] owned, string[] patterns) {
    Receipt result = new Receipt(); clock = Stopwatch.StartNew(); result.inspectorPid = GetCurrentProcessId();
    try {
      ushort machine, native;
      if (IntPtr.Size != 8 || !IsWow64Process2(GetCurrentProcess(), out machine, out native) || machine != 0 || native != 0x8664) throw new InvalidOperationException();
      result.architecture = "x64"; result.currentSid = WindowsIdentity.GetCurrent().User.Value;
      if (roots.Length == 0 || roots.Length > 64 || owned.Length == 0 || owned.Length > 32768 || patterns.Length > 8) throw new InvalidOperationException();
      foreach (string input in roots) {
        Root row = new Root(); row.index = result.roots.Count; row.requested = input;
        try { row.before = RootName(input); RejectNestedReparse(input); row.complete = true; } catch { row.error = "root-alias-incomplete"; }
        result.roots.Add(row);
      }
      foreach (Root row in result.roots) if (!row.complete) throw new InvalidOperationException();
      result.before = Snapshot(); HashSet<int> exceptions = new HashSet<int>(owned);
      foreach (Identity identity in result.before) {
        Bound(); ProcessRow row = new ProcessRow(); row.pid = identity.pid; row.created = identity.created; row.sid = identity.sid;
        string skip = identity.sid == null ? "identity-unavailable" : identity.pid == result.inspectorPid ? "inspector" : exceptions.Contains(identity.pid) ? "owned" : identity.sid != result.currentSid ? "foreign-user" : null;
        if (skip != null) { row.handles = Skip(skip); row.maps = Skip(skip); }
        else {
          IntPtr process = OpenProcess(0x1450, false, identity.pid);
          try {
            if (process == IntPtr.Zero || Sid(process, identity.created) != identity.sid) throw new InvalidOperationException();
            row.applicationOwner = Application(process, patterns, roots);
            row.handles = Handles(process, result.roots); row.maps = Maps(process, result.roots);
            if (Sid(process, identity.created) != identity.sid) throw new InvalidOperationException();
          } catch { row.handles = Skip("process-incomplete"); row.maps = Skip("process-incomplete"); }
          finally { if (process != IntPtr.Zero) CloseHandle(process); }
        }
        result.processes.Add(row);
        foreach (int root in row.handles.roots) result.owners.Add(new Owner {pid=row.pid, kind="handles", root=root});
        foreach (int root in row.maps.roots) result.owners.Add(new Owner {pid=row.pid, kind="maps", root=root});
      }
      result.after = Snapshot();
      foreach (Root row in result.roots) {
        try { row.after = RootName(row.requested); RejectNestedReparse(row.requested); if (row.before != row.after) throw new InvalidOperationException(); }
        catch { row.complete = false; row.error = "root-changed"; }
      }
    } catch { result.error = "native-incomplete"; }
    return result;
  }
}
'@ | Out-Null
  $receipt = [EchoFlowMigrationInspector]::Inspect([string[]]$request.roots, [int[]]$request.ownedPids, [string[]]$request.ownerPatterns)
  $receipt | ConvertTo-Json -Depth 12 -Compress
} catch {
  [Console]::Write('{"version":1,"error":"native-unavailable"}')
}
`
