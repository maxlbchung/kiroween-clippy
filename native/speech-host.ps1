# Clippy speech host: offline dictation via Windows' built-in System.Speech
# recognizer. Reads commands on stdin (start | stop | cancel | quit) and
# writes one JSON event per line on stdout. The microphone is only opened
# while listening.
param([string]$Culture = 'auto')

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8

try {
  Add-Type -AssemblyName System.Speech
} catch {
  [Console]::Out.WriteLine('{"type":"error","code":"no-speech-runtime","message":"System.Speech is not available on this PC."}')
  exit 2
}
$speechAsm = [System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location

$source = @'
using System;
using System.Globalization;
using System.Speech.Recognition;
using System.Text;
using System.Threading;

public static class ClippySpeechHost
{
    static readonly object Gate = new object();
    static SpeechRecognitionEngine engine;
    static volatile bool listening;
    static long lastLevelTicks;

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
                    if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    static void Emit(string json)
    {
        lock (Gate)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    static void EmitError(string code, string message)
    {
        Emit("{\"type\":\"error\",\"code\":\"" + Esc(code) + "\",\"message\":\"" + Esc(message) + "\"}");
    }

    static RecognizerInfo Pick(string preferred)
    {
        var all = SpeechRecognitionEngine.InstalledRecognizers();
        if (all.Count == 0) return null;
        var wanted = new string[] {
            preferred,
            CultureInfo.CurrentUICulture.Name,
            CultureInfo.CurrentCulture.Name,
            "en-US"
        };
        foreach (var name in wanted)
        {
            if (string.IsNullOrEmpty(name) || name == "auto") continue;
            foreach (var r in all)
                if (string.Equals(r.Culture.Name, name, StringComparison.OrdinalIgnoreCase)) return r;
        }
        return all[0];
    }

    public static void Run(string preferred)
    {
        RecognizerInfo info = Pick(preferred);
        if (info == null)
        {
            EmitError("no-recognizer", "No Windows speech recognizer is installed. Add a speech language in Settings > Time & language > Speech, or switch Clippy to cloud transcription.");
            return;
        }

        engine = new SpeechRecognitionEngine(info);
        engine.LoadGrammar(new DictationGrammar());
        engine.BabbleTimeout = TimeSpan.FromSeconds(0);
        engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(600);
        engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(900);

        engine.SpeechDetected += (s, e) => Emit("{\"type\":\"speech\"}");
        engine.SpeechHypothesized += (s, e) =>
            Emit("{\"type\":\"partial\",\"text\":\"" + Esc(e.Result.Text) + "\"}");
        engine.SpeechRecognized += (s, e) =>
            Emit("{\"type\":\"final\",\"text\":\"" + Esc(e.Result.Text) + "\",\"confidence\":" +
                 e.Result.Confidence.ToString("0.###", CultureInfo.InvariantCulture) + "}");
        engine.SpeechRecognitionRejected += (s, e) => Emit("{\"type\":\"rejected\"}");
        engine.AudioLevelUpdated += (s, e) =>
        {
            long now = DateTime.UtcNow.Ticks;
            if (now - lastLevelTicks < 400000) return; // ~25 updates/sec
            lastLevelTicks = now;
            Emit("{\"type\":\"level\",\"value\":" + e.AudioLevel + "}");
        };
        engine.RecognizeCompleted += (s, e) =>
        {
            listening = false;
            ThreadPool.QueueUserWorkItem(_ => { try { engine.SetInputToNull(); } catch { } });
            if (e.Error != null) EmitError("recognize-failed", e.Error.Message);
            Emit("{\"type\":\"stopped\"}");
        };

        Emit("{\"type\":\"ready\",\"recognizer\":\"" + Esc(info.Description) + "\",\"culture\":\"" + Esc(info.Culture.Name) + "\"}");

        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            string cmd = line.Trim().ToLowerInvariant();
            try
            {
                if (cmd == "start")
                {
                    if (listening) continue;
                    try { engine.SetInputToDefaultAudioDevice(); }
                    catch (Exception ex) { EmitError("no-microphone", "No microphone found: " + ex.Message); continue; }
                    listening = true;
                    engine.RecognizeAsync(RecognizeMode.Multiple);
                    Emit("{\"type\":\"started\"}");
                }
                else if (cmd == "stop")
                {
                    if (listening) engine.RecognizeAsyncStop(); else Emit("{\"type\":\"stopped\"}");
                }
                else if (cmd == "cancel")
                {
                    if (listening) engine.RecognizeAsyncCancel(); else Emit("{\"type\":\"stopped\"}");
                }
                else if (cmd == "quit")
                {
                    break;
                }
            }
            catch (Exception ex)
            {
                listening = false;
                EmitError("engine", ex.Message);
            }
        }
        try { engine.RecognizeAsyncCancel(); } catch { }
        engine.Dispose();
    }
}
'@

try {
  Add-Type -TypeDefinition $source -ReferencedAssemblies $speechAsm
  [ClippySpeechHost]::Run($Culture)
} catch {
  $msg = ($_.Exception.Message -replace '\\', '\\' -replace '"', '\"' -replace "`r|`n", ' ')
  [Console]::Out.WriteLine('{"type":"error","code":"host-crashed","message":"' + $msg + '"}')
  exit 1
}
