# Clippy desktop host: reads the screen through Windows UI Automation, sends
# synthesized mouse and keyboard input, and reports foreground-window
# changes, user input and Ctrl+Z presses.
#
# Protocol: one command per stdin line, fields separated by tabs, starting
# with a numeric request id. Replies and events are JSON, one per stdout line.
#   <id> snapshot <maxElements> <budgetMs>
#   <id> bounds <elementId>
#   <id> click <x> <y> <left|right> <0|1 double>
#   <id> type <base64 UTF-8 text>
#   <id> keys <key+key+...>
#   <id> scroll <x> <y> <dx> <dy>
#   <id> watch <input 0|1> <undo 0|1>
#   quit
# Coordinates are physical screen pixels. Windows owned by -ExcludePid (the
# Clippy app) never appear in snapshots or foreground events. Key events are
# reported without the key, except that Ctrl+Z is reported as "undo".
param([int]$ExcludePid = 0)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8

try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
} catch {
  [Console]::Out.WriteLine('{"type":"error","code":"no-uia","message":"UI Automation is not available on this PC."}')
  exit 2
}
$refs = @(
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.ControlType].Assembly.Location,
  [System.Windows.Rect].Assembly.Location,
  [System.Diagnostics.Stopwatch].Assembly.Location,
  [System.Collections.Generic.HashSet[int]].Assembly.Location
) | Select-Object -Unique

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class ClippyDesktopHost
{
    static readonly object Gate = new object();
    static int excludePid;
    static Dictionary<string, AutomationElement> lastElements = new Dictionary<string, AutomationElement>();

    // Output

    static string Esc(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || c == ' ' || c == ' ') sb.AppendFormat("\\u{0:x4}", (int)c);
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    static string Num(double v)
    {
        if (double.IsNaN(v) || double.IsInfinity(v)) return "0";
        return Math.Round(v).ToString(CultureInfo.InvariantCulture);
    }

    static string RectJson(double x, double y, double w, double h)
    {
        return "{\"x\":" + Num(x) + ",\"y\":" + Num(y) + ",\"width\":" + Num(w) + ",\"height\":" + Num(h) + "}";
    }

    static void Emit(string json)
    {
        lock (Gate)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    static void Reply(string id, string result)
    {
        Emit("{\"id\":" + id + ",\"ok\":true,\"result\":" + result + "}");
    }

    static void Fail(string id, string message)
    {
        Emit("{\"id\":" + id + ",\"ok\":false,\"error\":\"" + Esc(message) + "\"}");
    }

    // Win32

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr extra; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion U; }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    delegate void WinEventDelegate(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventDelegate proc, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, LowLevelProc proc, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadLibrary(string name);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

    const uint GW_OWNER = 4;
    const uint GW_HWNDNEXT = 2;
    const uint GA_ROOT = 2;
    const int GWL_STYLE = -16;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x80;
    const int WS_EX_DLGMODALFRAME = 0x1;
    const int WS_CHILD = 0x40000000;
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    const int DWMWA_CLOAKED = 14;
    const uint EVENT_SYSTEM_FOREGROUND = 3;
    const uint WINEVENT_OUTOFCONTEXT = 0;
    const uint WINEVENT_SKIPOWNPROCESS = 2;
    const int WH_KEYBOARD_LL = 13;
    const int WH_MOUSE_LL = 14;
    const uint LLMHF_INJECTED = 1;
    const uint LLKHF_INJECTED = 0x10;
    const uint WM_APP_WATCH = 0x8001;
    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_MOVE = 0x1;
    const uint MOUSEEVENTF_LEFTDOWN = 0x2;
    const uint MOUSEEVENTF_LEFTUP = 0x4;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x8;
    const uint MOUSEEVENTF_RIGHTUP = 0x10;
    const uint MOUSEEVENTF_WHEEL = 0x800;
    const uint MOUSEEVENTF_HWHEEL = 0x1000;
    const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1;
    const uint KEYEVENTF_KEYUP = 0x2;
    const uint KEYEVENTF_UNICODE = 0x4;
    static readonly IntPtr PER_MONITOR_AWARE_V2 = new IntPtr(-4);

    // Windows

    static string WindowText(IntPtr hwnd)
    {
        var sb = new StringBuilder(512);
        GetWindowText(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static string ClassOf(IntPtr hwnd)
    {
        var sb = new StringBuilder(256);
        GetClassName(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static uint PidOf(IntPtr hwnd)
    {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid;
    }

    static string ProcessName(uint pid)
    {
        try { return Process.GetProcessById((int)pid).ProcessName + ".exe"; }
        catch { return ""; }
    }

    static RECT Bounds(IntPtr hwnd)
    {
        RECT r;
        if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) == 0) return r;
        GetWindowRect(hwnd, out r);
        return r;
    }

    static bool Cloaked(IntPtr hwnd)
    {
        int cloaked;
        return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0;
    }

    static bool IsDialog(IntPtr hwnd, string cls)
    {
        if (cls == "#32770") return true;
        int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        return GetWindow(hwnd, GW_OWNER) != IntPtr.Zero && (ex & WS_EX_DLGMODALFRAME) != 0;
    }

    static bool IsFullScreen(IntPtr hwnd, string cls, RECT r)
    {
        if (cls == "Progman" || cls == "WorkerW") return false;
        var mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref mi)) return false;
        return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top
            && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
    }

    /** A visible, titled, uncloaked top-level window that is not Clippy's. */
    static bool IsUserWindow(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd) || IsIconic(hwnd) || Cloaked(hwnd)) return false;
        if ((GetWindowLong(hwnd, GWL_STYLE) & WS_CHILD) != 0) return false;
        if ((GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return false;
        if (excludePid != 0 && PidOf(hwnd) == (uint)excludePid) return false;
        return WindowText(hwnd).Length > 0;
    }

    static string WindowJson(IntPtr hwnd)
    {
        string cls = ClassOf(hwnd);
        uint pid = PidOf(hwnd);
        RECT r = Bounds(hwnd);
        return "{\"hwnd\":" + hwnd.ToInt64().ToString(CultureInfo.InvariantCulture)
            + ",\"title\":\"" + Esc(WindowText(hwnd)) + "\""
            + ",\"process\":\"" + Esc(ProcessName(pid)) + "\""
            + ",\"pid\":" + pid.ToString(CultureInfo.InvariantCulture)
            + ",\"className\":\"" + Esc(cls) + "\""
            + ",\"rect\":" + RectJson(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top)
            + ",\"isDialog\":" + (IsDialog(hwnd, cls) ? "true" : "false")
            + ",\"fullScreen\":" + (IsFullScreen(hwnd, cls, r) ? "true" : "false") + "}";
    }

    /** The foreground window, or the topmost user window when Clippy has focus. */
    static IntPtr TargetWindow()
    {
        IntPtr fg = GetForegroundWindow();
        if (fg != IntPtr.Zero) fg = GetAncestor(fg, GA_ROOT);
        if (IsUserWindow(fg)) return fg;
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            if (IsUserWindow(h)) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // UI Automation

    static readonly HashSet<string> Interactive = new HashSet<string>(new string[] {
        "Button", "CheckBox", "ComboBox", "Edit", "Hyperlink", "ListItem", "MenuItem",
        "RadioButton", "Slider", "Spinner", "SplitButton", "TabItem", "TreeItem",
        "DataItem", "Document", "Menu", "MenuBar", "Tab", "List", "Tree", "Table", "ScrollBar"
    });

    static CacheRequest MakeCache()
    {
        var cr = new CacheRequest();
        cr.Add(AutomationElement.NameProperty);
        cr.Add(AutomationElement.ControlTypeProperty);
        cr.Add(AutomationElement.BoundingRectangleProperty);
        cr.Add(AutomationElement.IsEnabledProperty);
        cr.Add(AutomationElement.HasKeyboardFocusProperty);
        cr.Add(AutomationElement.IsOffscreenProperty);
        cr.Add(AutomationElement.IsPasswordProperty);
        cr.Add(AutomationElement.RuntimeIdProperty);
        cr.Add(ValuePattern.ValueProperty);
        cr.TreeFilter = Automation.ControlViewCondition;
        cr.TreeScope = TreeScope.Element;
        cr.AutomationElementMode = AutomationElementMode.Full;
        return cr;
    }

    static object Cached(AutomationElement el, AutomationProperty p)
    {
        try { return el.GetCachedPropertyValue(p, true); }
        catch { return null; }
    }

    static string RuntimeKey(AutomationElement el)
    {
        var id = Cached(el, AutomationElement.RuntimeIdProperty) as int[];
        if (id == null) return null;
        var parts = new string[id.Length];
        for (int i = 0; i < id.Length; i++) parts[i] = id[i].ToString(CultureInfo.InvariantCulture);
        return string.Join(".", parts);
    }

    class Node
    {
        public AutomationElement El;
        public int Depth;
        public bool Chain;
    }

    static string Snapshot(int maxElements, int budgetMs)
    {
        var sw = Stopwatch.StartNew();
        var windows = new List<string>();
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            if (windows.Count < 30 && IsUserWindow(h)) windows.Add(WindowJson(h));
            return true;
        }, IntPtr.Zero);

        IntPtr target = TargetWindow();
        var elements = new StringBuilder();
        var ids = new Dictionary<string, AutomationElement>();
        bool truncated = false;
        if (target != IntPtr.Zero)
        {
            var cr = MakeCache();
            var walker = TreeWalker.ControlViewWalker;
            var nodes = new List<Node>();
            var seen = new HashSet<string>();
            AutomationElement root = null;
            using (cr.Activate())
            {
                try { root = AutomationElement.FromHandle(target); } catch { root = null; }
            }
            if (root != null)
            {
                // Focused element and its ancestors first, so truncation keeps them.
                try
                {
                    var chain = new List<AutomationElement>();
                    var el = AutomationElement.FocusedElement;
                    int guard = 0;
                    while (el != null && guard++ < 40)
                    {
                        AutomationElement cached = el.GetUpdatedCache(cr);
                        chain.Add(cached);
                        if (Automation.Compare(el, root)) { chain.Reverse(); break; }
                        el = walker.GetParent(el);
                        if (el == null) chain.Clear();
                    }
                    for (int i = 0; i < chain.Count; i++)
                    {
                        string key = RuntimeKey(chain[i]);
                        if (key != null) seen.Add(key);
                        nodes.Add(new Node { El = chain[i], Depth = i, Chain = true });
                    }
                }
                catch { }

                var queue = new Queue<Node>();
                queue.Enqueue(new Node { El = root, Depth = 0, Chain = false });
                while (queue.Count > 0)
                {
                    if (nodes.Count >= maxElements || sw.ElapsedMilliseconds > budgetMs) { truncated = true; break; }
                    Node n = queue.Dequeue();
                    AutomationElement cur = n.El;
                    if (n.Depth > 0)
                    {
                        object off = Cached(cur, AutomationElement.IsOffscreenProperty);
                        if (off is bool && (bool)off) continue;
                    }
                    string key = RuntimeKey(cur);
                    if (key == null || !seen.Contains(key))
                    {
                        if (key != null) seen.Add(key);
                        if (Worth(cur)) nodes.Add(n);
                    }
                    if (n.Depth >= 25) continue;
                    try
                    {
                        AutomationElement child = walker.GetFirstChild(cur, cr);
                        while (child != null)
                        {
                            queue.Enqueue(new Node { El = child, Depth = n.Depth + 1, Chain = false });
                            if (queue.Count > maxElements * 4) break;
                            child = walker.GetNextSibling(child, cr);
                        }
                    }
                    catch { }
                }
            }

            int count = 0;
            foreach (Node n in nodes)
            {
                if (count >= maxElements) { truncated = true; break; }
                string json = ElementJson(n, "e" + (count + 1));
                if (json == null) continue;
                count++;
                ids["e" + count] = n.El;
                if (elements.Length > 0) elements.Append(',');
                elements.Append(json);
            }
        }
        lastElements = ids;
        return "{\"foreground\":" + (target == IntPtr.Zero ? "null" : WindowJson(target))
            + ",\"windows\":[" + string.Join(",", windows.ToArray()) + "]"
            + ",\"elements\":[" + elements.ToString() + "]"
            + ",\"truncated\":" + (truncated ? "true" : "false") + "}";
    }

    static string TypeName(AutomationElement el)
    {
        var ct = Cached(el, AutomationElement.ControlTypeProperty) as ControlType;
        if (ct == null) return "Unknown";
        string n = ct.ProgrammaticName;
        int dot = n.LastIndexOf('.');
        return dot >= 0 ? n.Substring(dot + 1) : n;
    }

    static bool Worth(AutomationElement el)
    {
        string name = Cached(el, AutomationElement.NameProperty) as string;
        if (!string.IsNullOrEmpty(name)) return true;
        return Interactive.Contains(TypeName(el));
    }

    static string ElementJson(Node n, string id)
    {
        AutomationElement el = n.El;
        object rectObj = Cached(el, AutomationElement.BoundingRectangleProperty);
        if (!(rectObj is System.Windows.Rect)) return null;
        var r = (System.Windows.Rect)rectObj;
        if (r.IsEmpty || r.Width <= 0 || r.Height <= 0) return null;
        string name = Cached(el, AutomationElement.NameProperty) as string ?? "";
        if (name.Length > 200) name = name.Substring(0, 200);
        object enabled = Cached(el, AutomationElement.IsEnabledProperty);
        object focused = Cached(el, AutomationElement.HasKeyboardFocusProperty);
        object password = Cached(el, AutomationElement.IsPasswordProperty);
        string value = null;
        if (!(password is bool && (bool)password))
        {
            value = Cached(el, ValuePattern.ValueProperty) as string;
            if (value != null && value.Length > 200) value = value.Substring(0, 200);
        }
        return "{\"id\":\"" + id + "\""
            + ",\"name\":\"" + Esc(name) + "\""
            + ",\"type\":\"" + Esc(TypeName(el)) + "\""
            + ",\"rect\":" + RectJson(r.X, r.Y, r.Width, r.Height)
            + ",\"enabled\":" + (enabled is bool && !(bool)enabled ? "false" : "true")
            + ",\"focused\":" + (focused is bool && (bool)focused ? "true" : "false")
            + ",\"focusChain\":" + (n.Chain ? "true" : "false")
            + (string.IsNullOrEmpty(value) ? "" : ",\"value\":\"" + Esc(value) + "\"")
            + ",\"depth\":" + n.Depth.ToString(CultureInfo.InvariantCulture) + "}";
    }

    static string ElementBounds(string id)
    {
        AutomationElement el;
        if (!lastElements.TryGetValue(id, out el)) return "null";
        try
        {
            var r = el.Current.BoundingRectangle;
            if (r.IsEmpty || r.Width <= 0) return "null";
            return RectJson(r.X, r.Y, r.Width, r.Height);
        }
        catch { return "null"; }
    }

    // Input

    static void Send(List<INPUT> inputs)
    {
        if (inputs.Count == 0) return;
        INPUT[] arr = inputs.ToArray();
        SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    static INPUT Mouse(uint flags, int dx, int dy, uint data)
    {
        var i = new INPUT();
        i.type = INPUT_MOUSE;
        i.U.mi.dx = dx;
        i.U.mi.dy = dy;
        i.U.mi.mouseData = data;
        i.U.mi.dwFlags = flags;
        return i;
    }

    static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        var i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.U.ki.wVk = vk;
        i.U.ki.wScan = scan;
        i.U.ki.dwFlags = flags;
        return i;
    }

    static INPUT MoveTo(int x, int y)
    {
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
        int vw = Math.Max(1, GetSystemMetrics(78) - 1), vh = Math.Max(1, GetSystemMetrics(79) - 1);
        int nx = (int)Math.Round((x - vx) * 65535.0 / vw);
        int ny = (int)Math.Round((y - vy) * 65535.0 / vh);
        return Mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, nx, ny, 0);
    }

    static void Click(int x, int y, bool right, bool dbl)
    {
        uint down = right ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
        uint up = right ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
        Send(new List<INPUT> { MoveTo(x, y) });
        Thread.Sleep(40);
        Send(new List<INPUT> { Mouse(down, 0, 0, 0), Mouse(up, 0, 0, 0) });
        if (dbl)
        {
            Thread.Sleep(60);
            Send(new List<INPUT> { Mouse(down, 0, 0, 0), Mouse(up, 0, 0, 0) });
        }
    }

    static void TypeText(string text)
    {
        var batch = new List<INPUT>();
        foreach (char c in text)
        {
            if (c == '\r') continue;
            if (c == '\n' || c == '\t')
            {
                ushort vk = (ushort)(c == '\n' ? 0x0D : 0x09);
                batch.Add(Key(vk, 0, 0));
                batch.Add(Key(vk, 0, KEYEVENTF_KEYUP));
            }
            else
            {
                batch.Add(Key(0, c, KEYEVENTF_UNICODE));
                batch.Add(Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
            }
            if (batch.Count >= 64)
            {
                Send(batch);
                batch.Clear();
                Thread.Sleep(8);
            }
        }
        Send(batch);
    }

    static readonly HashSet<ushort> Extended = new HashSet<ushort>(new ushort[] {
        0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5D
    });

    static ushort VkOf(string k)
    {
        switch (k)
        {
            case "ctrl": return 0x11;
            case "alt": return 0x12;
            case "shift": return 0x10;
            case "win": return 0x5B;
            case "enter": return 0x0D;
            case "tab": return 0x09;
            case "escape": return 0x1B;
            case "space": return 0x20;
            case "backspace": return 0x08;
            case "delete": return 0x2E;
            case "insert": return 0x2D;
            case "home": return 0x24;
            case "end": return 0x23;
            case "pageup": return 0x21;
            case "pagedown": return 0x22;
            case "up": return 0x26;
            case "down": return 0x28;
            case "left": return 0x25;
            case "right": return 0x27;
            case "printscreen": return 0x2C;
            case "menu":
            case "apps": return 0x5D;
        }
        if (k.Length >= 2 && k[0] == 'f')
        {
            int n;
            if (int.TryParse(k.Substring(1), out n) && n >= 1 && n <= 12) return (ushort)(0x70 + n - 1);
        }
        if (k.Length == 1)
        {
            char c = char.ToUpperInvariant(k[0]);
            if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return (ushort)c;
        }
        return 0;
    }

    static void PressKeys(string combo)
    {
        string[] parts = combo.Split('+');
        var vks = new List<ushort>();
        foreach (string p in parts)
        {
            ushort vk = VkOf(p.Trim().ToLowerInvariant());
            if (vk == 0) throw new ArgumentException("Unknown key: " + p);
            vks.Add(vk);
        }
        var batch = new List<INPUT>();
        foreach (ushort vk in vks)
            batch.Add(Key(vk, 0, Extended.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0));
        for (int i = vks.Count - 1; i >= 0; i--)
            batch.Add(Key(vks[i], 0, KEYEVENTF_KEYUP | (Extended.Contains(vks[i]) ? KEYEVENTF_EXTENDEDKEY : 0)));
        Send(batch);
    }

    static void Scroll(int x, int y, int dx, int dy)
    {
        Send(new List<INPUT> { MoveTo(x, y) });
        Thread.Sleep(30);
        var batch = new List<INPUT>();
        if (dy != 0) batch.Add(Mouse(MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)(dy * 120))));
        if (dx != 0) batch.Add(Mouse(MOUSEEVENTF_HWHEEL, 0, 0, unchecked((uint)(dx * 120))));
        Send(batch);
    }

    // Hooks

    static uint hookThreadId;
    static volatile bool wantInput;
    static volatile bool wantUndo;
    static IntPtr mouseHook = IntPtr.Zero;
    static IntPtr keyHook = IntPtr.Zero;
    static LowLevelProc mouseProc;
    static LowLevelProc keyProc;
    static WinEventDelegate winEventProc;
    static IntPtr winEventHook;
    static POINT anchor;
    static bool anchored;
    static long lastMoveEmit;
    static IntPtr lastForeground = IntPtr.Zero;

    static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && wantInput)
        {
            var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            if ((info.flags & LLMHF_INJECTED) == 0)
            {
                int msg = wParam.ToInt32();
                if (msg == 0x200)
                {
                    if (!anchored) { anchor = info.pt; anchored = true; }
                    double d = Math.Sqrt(Math.Pow(info.pt.X - anchor.X, 2) + Math.Pow(info.pt.Y - anchor.Y, 2));
                    long now = Environment.TickCount;
                    if (d > 8 && now - lastMoveEmit > 100)
                    {
                        lastMoveEmit = now;
                        anchor = info.pt;
                        EmitInput("move", info.pt);
                    }
                }
                else if (msg == 0x201 || msg == 0x204 || msg == 0x207)
                {
                    EmitInput("click", info.pt);
                }
                else if (msg == 0x20A || msg == 0x20E)
                {
                    EmitInput("move", info.pt);
                }
            }
            else
            {
                // Synthesized moves re-anchor, so only the user's own motion counts.
                anchor = info.pt;
                anchored = true;
            }
        }
        return CallNextHookEx(mouseHook, code, wParam, lParam);
    }

    static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            int msg = wParam.ToInt32();
            var info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if ((msg == 0x100 || msg == 0x104) && (info.flags & LLKHF_INJECTED) == 0)
            {
                if (wantInput) Emit("{\"type\":\"input\",\"kind\":\"key\"}");
                if (wantUndo && info.vkCode == 0x5A && (GetAsyncKeyState(0x11) & 0x8000) != 0)
                    Emit("{\"type\":\"undo\"}");
            }
        }
        return CallNextHookEx(keyHook, code, wParam, lParam);
    }

    static void EmitInput(string kind, POINT pt)
    {
        Emit("{\"type\":\"input\",\"kind\":\"" + kind + "\",\"x\":" + pt.X.ToString(CultureInfo.InvariantCulture)
            + ",\"y\":" + pt.Y.ToString(CultureInfo.InvariantCulture) + "}");
    }

    static void OnWinEvent(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        try { ReportForeground(hwnd); } catch { }
    }

    static void ReportForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        hwnd = GetAncestor(hwnd, GA_ROOT);
        if (hwnd == lastForeground || !IsUserWindow(hwnd)) return;
        lastForeground = hwnd;
        Emit("{\"type\":\"foreground\",\"window\":" + WindowJson(hwnd) + "}");
    }

    static void ApplyWatch()
    {
        IntPtr user32 = LoadLibrary("user32.dll");
        bool needMouse = wantInput;
        bool needKeys = wantInput || wantUndo;
        if (needMouse && mouseHook == IntPtr.Zero)
        {
            anchored = false;
            mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, user32, 0);
        }
        else if (!needMouse && mouseHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(mouseHook);
            mouseHook = IntPtr.Zero;
        }
        if (needKeys && keyHook == IntPtr.Zero) keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, user32, 0);
        else if (!needKeys && keyHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(keyHook);
            keyHook = IntPtr.Zero;
        }
    }

    static void HookThread(object ready)
    {
        try { SetThreadDpiAwarenessContext(PER_MONITOR_AWARE_V2); } catch { }
        hookThreadId = GetCurrentThreadId();
        mouseProc = OnMouse;
        keyProc = OnKey;
        winEventProc = OnWinEvent;
        winEventHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero,
            winEventProc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        ((ManualResetEvent)ready).Set();
        try { ReportForeground(GetForegroundWindow()); } catch { }
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.message == WM_APP_WATCH) { ApplyWatch(); continue; }
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }

    // Main loop

    static int Int(string s)
    {
        return (int)Math.Round(double.Parse(s, CultureInfo.InvariantCulture));
    }

    static void Handle(string[] f)
    {
        string id = f[0];
        string cmd = f.Length > 1 ? f[1] : "";
        try
        {
            switch (cmd)
            {
                case "snapshot":
                    Reply(id, Snapshot(Int(f[2]), Int(f[3])));
                    break;
                case "bounds":
                    Reply(id, ElementBounds(f[2]));
                    break;
                case "click":
                    Click(Int(f[2]), Int(f[3]), f[4] == "right", f[5] == "1");
                    Reply(id, "true");
                    break;
                case "type":
                    TypeText(Encoding.UTF8.GetString(Convert.FromBase64String(f[2])));
                    Reply(id, "true");
                    break;
                case "keys":
                    PressKeys(f[2]);
                    Reply(id, "true");
                    break;
                case "scroll":
                    Scroll(Int(f[2]), Int(f[3]), Int(f[4]), Int(f[5]));
                    Reply(id, "true");
                    break;
                case "watch":
                    wantInput = f[2] == "1";
                    wantUndo = f[3] == "1";
                    PostThreadMessage(hookThreadId, WM_APP_WATCH, IntPtr.Zero, IntPtr.Zero);
                    Reply(id, "true");
                    break;
                default:
                    Fail(id, "Unknown command: " + cmd);
                    break;
            }
        }
        catch (Exception e)
        {
            Fail(id, e.Message);
        }
    }

    public static void Run(int exclude)
    {
        excludePid = exclude;
        try { SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2); } catch { }
        try { SetThreadDpiAwarenessContext(PER_MONITOR_AWARE_V2); } catch { }
        var ready = new ManualResetEvent(false);
        var t = new Thread(HookThread);
        t.IsBackground = true;
        t.Start(ready);
        ready.WaitOne(5000);
        Emit("{\"type\":\"ready\"}");
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            line = line.Trim('﻿', '\r', '\n');
            if (line.Length == 0) continue;
            if (line == "quit") break;
            Handle(line.Split('\t'));
        }
        Environment.Exit(0);
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies $refs
[ClippyDesktopHost]::Run($ExcludePid)
