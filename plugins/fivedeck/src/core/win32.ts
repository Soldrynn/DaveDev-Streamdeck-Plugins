/**
 * Thin Win32 layer over koffi: synthetic keyboard input, the foreground process, the process
 * list, and bringing a game window to the front. It loads lazily and reports `undefined` on
 * other platforms so the rest of the plugin (and the tests) run anywhere.
 */
import type { KeyStroke } from "./keys.ts";

export interface ProcessInfo {
  pid: number;
  name: string;
}

export interface NativeInput {
  /** Sends key strokes as one atomic SendInput batch. Returns false when Windows rejected any. */
  send(strokes: readonly KeyStroke[], scanCodeOnly?: boolean): boolean;
  /** Types text as Unicode characters, independent of keyboard layout. */
  typeText(text: string): boolean;
  /** The process that owns the foreground window. */
  foregroundProcess(): ProcessInfo | undefined;
  /** Every running process (image name only). */
  processes(): ProcessInfo[];
  /** Brings the largest visible top-level window of any of the processes to the front. */
  focusProcessWindow(pids: readonly number[]): boolean;
}

const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const KEYEVENTF_UNICODE = 0x4;
const KEYEVENTF_SCANCODE = 0x8;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TH32CS_SNAPPROCESS = 0x2;
const SW_RESTORE = 9;
const INVALID_HANDLE = 0xffffffffffffffffn;

let loaded: Promise<NativeInput | undefined> | undefined;

export function loadNativeInput(log: (message: string) => void = () => undefined): Promise<NativeInput | undefined> {
  loaded ??= create(log);
  return loaded;
}

async function create(log: (message: string) => void): Promise<NativeInput | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const koffi = (await import("koffi")).default;
    return bind(koffi);
  } catch (error) {
    log(`Native input is unavailable: ${String(error)}`);
    return undefined;
  }
}

function bind(koffi: any): NativeInput {
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");

  koffi.alias("DWORD", "uint32_t");
  const HANDLE = koffi.pointer("HANDLE", koffi.opaque());
  koffi.alias("HWND", HANDLE);
  const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
    wVk: "uint16_t", wScan: "uint16_t", dwFlags: "uint32_t", time: "uint32_t", dwExtraInfo: "uintptr_t"
  });
  const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
    dx: "int32_t", dy: "int32_t", mouseData: "uint32_t", dwFlags: "uint32_t", time: "uint32_t", dwExtraInfo: "uintptr_t"
  });
  const HARDWAREINPUT = koffi.struct("HARDWAREINPUT", { uMsg: "uint32_t", wParamL: "uint16_t", wParamH: "uint16_t" });
  koffi.union("INPUT_UNION", { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
  const INPUT = koffi.struct("INPUT", { type: "uint32_t", u: "INPUT_UNION" });
  koffi.struct("PROCESSENTRY32W", {
    dwSize: "uint32_t", cntUsage: "uint32_t", th32ProcessID: "uint32_t", th32DefaultHeapID: "uintptr_t",
    th32ModuleID: "uint32_t", cntThreads: "uint32_t", th32ParentProcessID: "uint32_t", pcPriClassBase: "int32_t",
    dwFlags: "uint32_t", szExeFile: koffi.array("char16_t", 260, "String")
  });
  koffi.struct("RECT", { left: "int32_t", top: "int32_t", right: "int32_t", bottom: "int32_t" });
  koffi.proto("bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)");

  const inputSize: number = koffi.sizeof(INPUT);
  const SendInput = user32.func("uint32_t __stdcall SendInput(uint32_t cInputs, INPUT *pInputs, int cbSize)");
  const GetForegroundWindow = user32.func("HWND __stdcall GetForegroundWindow()");
  const GetWindowThreadProcessId = user32.func("DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)");
  const EnumWindows = user32.func("bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, intptr_t lParam)");
  const IsWindowVisible = user32.func("bool __stdcall IsWindowVisible(HWND hWnd)");
  const IsIconic = user32.func("bool __stdcall IsIconic(HWND hWnd)");
  const GetWindowRect = user32.func("bool __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *lpRect)");
  const ShowWindow = user32.func("bool __stdcall ShowWindow(HWND hWnd, int nCmdShow)");
  const SetForegroundWindow = user32.func("bool __stdcall SetForegroundWindow(HWND hWnd)");
  const OpenProcess = kernel32.func("HANDLE __stdcall OpenProcess(DWORD dwDesiredAccess, bool bInheritHandle, DWORD dwProcessId)");
  const QueryFullProcessImageNameW = kernel32.func("bool __stdcall QueryFullProcessImageNameW(HANDLE hProcess, DWORD dwFlags, _Out_ uint8_t *lpExeName, _Inout_ DWORD *lpdwSize)");
  const CloseHandle = kernel32.func("bool __stdcall CloseHandle(HANDLE hObject)");
  const CreateToolhelp32Snapshot = kernel32.func("HANDLE __stdcall CreateToolhelp32Snapshot(DWORD dwFlags, DWORD th32ProcessID)");
  const Process32FirstW = kernel32.func("bool __stdcall Process32FirstW(HANDLE hSnapshot, _Inout_ PROCESSENTRY32W *lppe)");
  const Process32NextW = kernel32.func("bool __stdcall Process32NextW(HANDLE hSnapshot, _Inout_ PROCESSENTRY32W *lppe)");
  const entrySize: number = koffi.sizeof("PROCESSENTRY32W");

  const keyboard = (wVk: number, wScan: number, dwFlags: number) => ({
    type: INPUT_KEYBOARD,
    u: { ki: { wVk, wScan, dwFlags, time: 0, dwExtraInfo: 0 } }
  });

  function sendBatch(inputs: object[]): boolean {
    if (inputs.length === 0) return true;
    return SendInput(inputs.length, inputs, inputSize) === inputs.length;
  }

  function imageName(pid: number): string | undefined {
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!handle) return undefined;
    try {
      const buffer = Buffer.alloc(1040);
      const size = [520];
      if (!QueryFullProcessImageNameW(handle, 0, buffer, size)) return undefined;
      const path = buffer.toString("utf16le", 0, size[0] * 2);
      return path.slice(path.lastIndexOf("\\") + 1);
    } finally {
      CloseHandle(handle);
    }
  }

  return {
    send(strokes, scanCodeOnly = false) {
      return sendBatch(strokes.map(({ key, up }) => {
        let flags = up ? KEYEVENTF_KEYUP : 0;
        if (key.extended) flags |= KEYEVENTF_EXTENDEDKEY;
        if (scanCodeOnly) flags |= KEYEVENTF_SCANCODE;
        return keyboard(scanCodeOnly ? 0 : key.vk, key.scan, flags);
      }));
    },
    typeText(text) {
      const inputs: object[] = [];
      for (let index = 0; index < text.length; index++) {
        const unit = text.charCodeAt(index);
        inputs.push(keyboard(0, unit, KEYEVENTF_UNICODE), keyboard(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
      }
      return sendBatch(inputs);
    },
    foregroundProcess() {
      const hwnd = GetForegroundWindow();
      if (!hwnd) return undefined;
      const pid = [0];
      if (!GetWindowThreadProcessId(hwnd, pid) || !pid[0]) return undefined;
      const name = imageName(pid[0]);
      return name ? { pid: pid[0], name } : undefined;
    },
    processes() {
      const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
      if (!snapshot || BigInt(snapshot) === INVALID_HANDLE) return [];
      const result: ProcessInfo[] = [];
      try {
        const entry: any = { dwSize: entrySize };
        for (let ok = Process32FirstW(snapshot, entry); ok; ok = Process32NextW(snapshot, entry)) {
          result.push({ pid: entry.th32ProcessID, name: String(entry.szExeFile) });
          entry.dwSize = entrySize;
        }
      } finally {
        CloseHandle(snapshot);
      }
      return result;
    },
    focusProcessWindow(pids) {
      const wanted = new Set(pids);
      let best: { hwnd: unknown; area: number } | undefined;
      EnumWindows((hwnd: unknown) => {
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        if (!wanted.has(pid[0]) || !IsWindowVisible(hwnd)) return true;
        const rect: any = {};
        GetWindowRect(hwnd, rect);
        const area = Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
        if (!best || area > best.area) best = { hwnd, area };
        return true;
      }, 0);
      if (!best) return false;
      if (IsIconic(best.hwnd)) ShowWindow(best.hwnd, SW_RESTORE);
      // Windows only lets the process that produced the last input change the foreground window;
      // a synthetic Alt tap makes this process that producer without typing anything visible.
      const alt = { vk: 0xa4, scan: 0x38 };
      sendBatch([keyboard(alt.vk, alt.scan, 0), keyboard(alt.vk, alt.scan, KEYEVENTF_KEYUP)]);
      return SetForegroundWindow(best.hwnd);
    }
  };
}

/** Exposed for tests: builds the struct layout on any platform and reports sizes. */
export async function layoutForTests(): Promise<{ input: number; entry: number }> {
  const koffi = (await import("koffi")).default as any;
  const kb = koffi.struct({ wVk: "uint16_t", wScan: "uint16_t", dwFlags: "uint32_t", time: "uint32_t", dwExtraInfo: "uintptr_t" });
  const mouse = koffi.struct({ dx: "int32_t", dy: "int32_t", mouseData: "uint32_t", dwFlags: "uint32_t", time: "uint32_t", dwExtraInfo: "uintptr_t" });
  const hardware = koffi.struct({ uMsg: "uint32_t", wParamL: "uint16_t", wParamH: "uint16_t" });
  const union = koffi.union({ mi: mouse, ki: kb, hi: hardware });
  const input = koffi.struct({ type: "uint32_t", u: union });
  const entry = koffi.struct({
    dwSize: "uint32_t", cntUsage: "uint32_t", th32ProcessID: "uint32_t", th32DefaultHeapID: "uintptr_t",
    th32ModuleID: "uint32_t", cntThreads: "uint32_t", th32ParentProcessID: "uint32_t", pcPriClassBase: "int32_t",
    dwFlags: "uint32_t", szExeFile: koffi.array("char16_t", 260, "String")
  });
  return { input: koffi.sizeof(input), entry: koffi.sizeof(entry) };
}
