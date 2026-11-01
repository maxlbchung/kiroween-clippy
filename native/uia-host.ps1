# Clippy hands: UI Automation, input and screen capture for the agent.
# Reads one JSON request per line on stdin ({id, cmd, ...}) and writes one JSON
# reply per line on stdout ({id, ok, result} or {id, ok:false, error}).
param([int]$ExcludePid = 0)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

public static class ClippyHands
{
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy, mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public int dwFlags, time; public IntPtr dwExtraInfo; public int pad1, pad2; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public int type; public INPUTUNION u; }

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short VkKeyScan(char c);

    const int INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const int KEYUP = 2, UNICODE = 4;
    const int L_DOWN = 2, L_UP = 4, R_DOWN = 8, R_UP = 16, WHEEL = 0x800, HWHEEL = 0x1000;
    const int MAX_VISITS = 4000, MAX_LINES = 500, MAX_VALUE = 1500, MAX_SHOT = 1280;

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 16 };
    static readonly Dictionary<int, AutomationElement> Refs = new Dictionary<int, AutomationElement>();
    static int nextRef = 1;
    static int excludePid;
    static double shotX, shotY, shotScale = 0;

    public static void Run(int exclude)
    {
        excludePid = exclude;
        SetProcessDPIAware();
        var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        Reply(new Dictionary<string, object> { { "type", "ready" } });
        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            line = line.TrimStart((char)0xFEFF).Trim();
            if (line.Length == 0) continue;
            var reply = new Dictionary<string, object>();
            try
            {
                var req = Json.Deserialize<Dictionary<string, object>>(line);
                reply["id"] = req["id"];
                reply["result"] = Handle(req);
                reply["ok"] = true;
            }
            catch (ElementNotAvailableException)
            {
                reply["ok"] = false;
                reply["error"] = "That element no longer exists. Call read_window again.";
            }
            catch (Exception ex)
            {
                reply["ok"] = false;
                reply["error"] = ex.Message;
            }
            Reply(reply);
        }
    }

    static void Reply(object o)
    {
        Console.Out.WriteLine(Json.Serialize(o));
        Console.Out.Flush();
    }

    static string Str(Dictionary<string, object> r, string k, string def = null) { object v; return r.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : def; }
    static long Num(Dictionary<string, object> r, string k, long def = 0) { object v; return r.TryGetValue(k, out v) && v != null ? Convert.ToInt64(v) : def; }
    static bool Flag(Dictionary<string, object> r, string k) { object v; return r.TryGetValue(k, out v) && v is bool && (bool)v; }

    static object Handle(Dictionary<string, object> r)
    {
        switch (Str(r, "cmd"))
        {
            case "windows": return Windows();
            case "read": return Read(new IntPtr(Num(r, "window")), Str(r, "query"), (int)Num(r, "depth", 30));
            case "click": return Click(Element(r), Str(r, "button", "left"), Flag(r, "double"));
            case "click_at": return ClickAt(r);
            case "type": return TypeText(r);
            case "keys": return Keys(Str(r, "keys"));
            case "scroll": return Scroll(r);
            case "focus": Focus(new IntPtr(Num(r, "window"))); return "focused";
            case "screenshot": return Shot(Num(r, "window"));
            case "rect": { var b = Element(r).Current.BoundingRectangle; return new Dictionary<string, object> { { "x", b.X }, { "y", b.Y }, { "width", b.Width }, { "height", b.Height } }; }
            default: throw new ArgumentException("Unknown command");
        }
    }

    static AutomationElement Element(Dictionary<string, object> r)
    {
        AutomationElement el;
        if (!Refs.TryGetValue((int)Num(r, "ref"), out el)) throw new ArgumentException("Unknown ref. Call read_window again.");
        return el;
    }

    // ---------------------------------------------------------------- reading
    static object Windows()
    {
        var list = new List<object>();
        foreach (AutomationElement w in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition))
        {
            try
            {
                var c = w.Current;
                if (c.ProcessId == excludePid || string.IsNullOrWhiteSpace(c.Name) || c.BoundingRectangle.IsEmpty) continue;
                string proc = "";
                try { proc = Process.GetProcessById(c.ProcessId).ProcessName; } catch { }
                list.Add(new Dictionary<string, object> { { "window", c.NativeWindowHandle }, { "title", c.Name }, { "process", proc } });
            }
            catch (ElementNotAvailableException) { }
        }
        return list;
    }

    static object Read(IntPtr hwnd, string query, int maxDepth)
    {
        if (Refs.Count > 20000) Refs.Clear();
        var root = AutomationElement.FromHandle(hwnd);
        var sb = new StringBuilder();
        var walk = new Walk { Query = string.IsNullOrEmpty(query) ? null : query, MaxDepth = maxDepth };
        Visit(root, 0, sb, walk);
        if (walk.Truncated) sb.AppendLine("[truncated: pass query to search this window]");
        return sb.ToString();
    }

    class Walk { public string Query; public int MaxDepth, Visits, Lines; public bool Truncated; }

    static void Visit(AutomationElement el, int depth, StringBuilder sb, Walk w)
    {
        if (++w.Visits > MAX_VISITS || w.Lines >= MAX_LINES) { w.Truncated = true; return; }
        AutomationElement.AutomationElementInformation c;
        try { c = el.Current; } catch (ElementNotAvailableException) { return; }
        if (c.IsOffscreen) return;
        string role = c.ControlType.ProgrammaticName.Replace("ControlType.", "");
        string name = c.Name ?? "";
        string value = ValueOf(el, c);
        bool layout = (role == "Pane" || role == "Group" || role == "Custom") && name.Length == 0 && value.Length == 0;
        bool match = w.Query == null
            || name.IndexOf(w.Query, StringComparison.OrdinalIgnoreCase) >= 0
            || value.IndexOf(w.Query, StringComparison.OrdinalIgnoreCase) >= 0;
        int next = depth;
        if (!layout && match)
        {
            int id = nextRef++;
            Refs[id] = el;
            w.Lines++;
            if (w.Query == null) sb.Append(' ', depth * 2);
            sb.Append('[').Append(id).Append("] ").Append(role);
            if (name.Length > 0) sb.Append(" \"").Append(Flat(name, 200)).Append('"');
            if (value.Length > 0) sb.Append(" value=\"").Append(Flat(value, MAX_VALUE)).Append('"');
            if (!c.IsEnabled) sb.Append(" (disabled)");
            string state = StateOf(el);
            if (state != null) sb.Append(" (").Append(state).Append(')');
            sb.AppendLine();
            next = depth + 1;
        }
        if (depth >= w.MaxDepth) return;
        var walker = TreeWalker.ControlViewWalker;
        AutomationElement child;
        try { child = walker.GetFirstChild(el); } catch (ElementNotAvailableException) { return; }
        while (child != null && !w.Truncated)
        {
            Visit(child, next, sb, w);
            try { child = walker.GetNextSibling(child); } catch (ElementNotAvailableException) { return; }
        }
    }

    static string Flat(string s, int max)
    {
        s = s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n");
        return s.Length > max ? s.Substring(0, max) + "..." : s;
    }

    static string ValueOf(AutomationElement el, AutomationElement.AutomationElementInformation c)
    {
        if (c.IsPassword) return "";
        object p;
        try
        {
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out p)) return ((ValuePattern)p).Current.Value ?? "";
            if (c.ControlType == ControlType.Document && el.TryGetCurrentPattern(TextPattern.Pattern, out p))
                return ((TextPattern)p).DocumentRange.GetText(MAX_VALUE) ?? "";
        }
        catch (InvalidOperationException) { }
        catch (ElementNotAvailableException) { }
        return "";
    }

    static string StateOf(AutomationElement el)
    {
        object p;
        try
        {
            if (el.TryGetCurrentPattern(TogglePattern.Pattern, out p)) return "toggle:" + ((TogglePattern)p).Current.ToggleState;
            if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p) && ((SelectionItemPattern)p).Current.IsSelected) return "selected";
            if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) return ((ExpandCollapsePattern)p).Current.ExpandCollapseState.ToString().ToLowerInvariant();
        }
        catch (InvalidOperationException) { }
        catch (ElementNotAvailableException) { }
        return null;
    }

    // ---------------------------------------------------------------- acting
    static object Click(AutomationElement el, string button, bool dbl)
    {
        if (button == "left" && !dbl)
        {
            object p;
            if (el.TryGetCurrentPattern(InvokePattern.Pattern, out p)) { Detached(((InvokePattern)p).Invoke); return "invoked"; }
            if (el.TryGetCurrentPattern(TogglePattern.Pattern, out p)) { Detached(((TogglePattern)p).Toggle); return "toggled"; }
            if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { Detached(((SelectionItemPattern)p).Select); return "selected"; }
            if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p))
            {
                var e = (ExpandCollapsePattern)p;
                if (e.Current.ExpandCollapseState == ExpandCollapseState.Collapsed) Detached(e.Expand); else Detached(e.Collapse);
                return "toggled expansion";
            }
        }
        System.Windows.Point pt;
        if (!el.TryGetClickablePoint(out pt))
        {
            var b = el.Current.BoundingRectangle;
            if (b.IsEmpty) throw new InvalidOperationException("Element has no on-screen position.");
            pt = new System.Windows.Point(b.X + b.Width / 2, b.Y + b.Height / 2);
        }
        Mouse((int)pt.X, (int)pt.Y, button, dbl);
        return "clicked at screen position";
    }

    // Invoke blocks until a modal dialog it opens is closed; don't wait for that.
    static void Detached(Action a)
    {
        Exception err = null;
        var t = new Thread(() => { try { a(); } catch (Exception ex) { err = ex; } });
        t.IsBackground = true;
        t.Start();
        if (t.Join(2000) && err != null) throw err;
    }

    static object ClickAt(Dictionary<string, object> r)
    {
        if (shotScale == 0) throw new InvalidOperationException("Take a screenshot first.");
        Mouse((int)(shotX + Num(r, "x") / shotScale), (int)(shotY + Num(r, "y") / shotScale), Str(r, "button", "left"), Flag(r, "double"));
        return "clicked";
    }

    static void Mouse(int x, int y, string button, bool dbl)
    {
        SetCursorPos(x, y);
        Thread.Sleep(40);
        int down = button == "right" ? R_DOWN : L_DOWN, up = button == "right" ? R_UP : L_UP;
        for (int i = 0; i < (dbl ? 2 : 1); i++)
        {
            Send(MouseEvent(down, 0), MouseEvent(up, 0));
            Thread.Sleep(30);
        }
    }

    static INPUT MouseEvent(int flags, int data)
    {
        var i = new INPUT { type = INPUT_MOUSE };
        i.u.mi.dwFlags = flags;
        i.u.mi.mouseData = data;
        return i;
    }

    static INPUT Key(ushort vk, ushort scan, int flags)
    {
        var i = new INPUT { type = INPUT_KEYBOARD };
        i.u.ki.wVk = vk;
        i.u.ki.wScan = scan;
        i.u.ki.dwFlags = flags;
        return i;
    }

    static void Send(params INPUT[] inputs)
    {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
            throw new InvalidOperationException("Windows blocked the input (the target may be running as administrator).");
    }

    static object TypeText(Dictionary<string, object> r)
    {
        string text = Str(r, "text", "");
        if (r.ContainsKey("ref") && r["ref"] != null)
        {
            var el = Element(r);
            object p;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out p) && !((ValuePattern)p).Current.IsReadOnly)
            {
                ((ValuePattern)p).SetValue(text);
                return "value set";
            }
            el.SetFocus();
            Thread.Sleep(60);
        }
        foreach (char ch in text)
        {
            if (ch == '\r') continue;
            if (ch == '\n') Send(Key(0x0D, 0, 0), Key(0x0D, 0, KEYUP));
            else Send(Key(0, ch, UNICODE), Key(0, ch, UNICODE | KEYUP));
        }
        return "typed";
    }

    static readonly Dictionary<string, ushort> Vk = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase) {
        { "ctrl", 0x11 }, { "control", 0x11 }, { "alt", 0x12 }, { "shift", 0x10 }, { "win", 0x5B },
        { "enter", 0x0D }, { "return", 0x0D }, { "tab", 0x09 }, { "esc", 0x1B }, { "escape", 0x1B }, { "space", 0x20 },
        { "backspace", 0x08 }, { "delete", 0x2E }, { "del", 0x2E }, { "insert", 0x2D }, { "home", 0x24 }, { "end", 0x23 },
        { "pageup", 0x21 }, { "pagedown", 0x22 }, { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 },
    };

    static ushort VkOf(string name)
    {
        ushort vk;
        if (Vk.TryGetValue(name, out vk)) return vk;
        int f;
        if (name.Length > 1 && (name[0] == 'f' || name[0] == 'F') && int.TryParse(name.Substring(1), out f) && f >= 1 && f <= 24) return (ushort)(0x6F + f);
        if (name.Length == 1)
        {
            short scan = VkKeyScan(name[0]);
            if (scan != -1) return (ushort)(scan & 0xFF);
        }
        throw new ArgumentException("Unknown key: " + name);
    }

    static object Keys(string keys)
    {
        foreach (var combo in (keys ?? "").Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var vks = combo.Split('+').Select(VkOf).ToArray();
            Send(vks.Select(v => Key(v, 0, 0)).Concat(vks.Reverse().Select(v => Key(v, 0, KEYUP))).ToArray());
            Thread.Sleep(50);
        }
        return "pressed";
    }

    static object Scroll(Dictionary<string, object> r)
    {
        if (r.ContainsKey("ref") && r["ref"] != null)
        {
            var b = Element(r).Current.BoundingRectangle;
            SetCursorPos((int)(b.X + b.Width / 2), (int)(b.Y + b.Height / 2));
            Thread.Sleep(40);
        }
        string dir = Str(r, "direction", "down");
        int ticks = (int)Num(r, "amount", 3) * 120;
        bool horizontal = dir == "left" || dir == "right";
        Send(MouseEvent(horizontal ? HWHEEL : WHEEL, dir == "down" || dir == "left" ? -ticks : ticks));
        return "scrolled";
    }

    static void Focus(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, 9);
        // Windows only lets the process that last had input take the foreground.
        Send(Key(0x12, 0, 0), Key(0x12, 0, KEYUP));
        if (!SetForegroundWindow(h)) throw new InvalidOperationException("Windows refused to focus that window.");
        Thread.Sleep(120);
    }

    static object Shot(long window)
    {
        var bounds = (window != 0 ? Screen.FromHandle(new IntPtr(window)) : Screen.PrimaryScreen).Bounds;
        double scale = Math.Min(1.0, (double)MAX_SHOT / bounds.Width);
        int w = (int)(bounds.Width * scale), h = (int)(bounds.Height * scale);
        using (var full = new Bitmap(bounds.Width, bounds.Height))
        using (var small = new Bitmap(w, h))
        using (var ms = new MemoryStream())
        {
            using (var g = Graphics.FromImage(full)) g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
            using (var g = Graphics.FromImage(small))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBilinear;
                g.DrawImage(full, 0, 0, w, h);
            }
            var jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
            var opts = new EncoderParameters(1);
            opts.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 70L);
            small.Save(ms, jpeg, opts);
            shotX = bounds.X; shotY = bounds.Y; shotScale = scale;
            return new Dictionary<string, object> { { "data", Convert.ToBase64String(ms.ToArray()) }, { "width", w }, { "height", h } };
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @(
  'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Drawing', 'System.Windows.Forms',
  'System.Web.Extensions', 'System.Core', 'System.Linq'
) -ErrorAction Stop

[ClippyHands]::Run($ExcludePid)
