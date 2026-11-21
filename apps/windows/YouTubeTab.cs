using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;
using Microsoft.Win32;

static partial class YouTubeTab {
    static AutomationElement pinned, pinnedWindow, pinnedBar;
    public static string TitleKey(string title) {
        // YouTube's media metadata preserves whitespace that Edge collapses in its tab label.
        return Regex.Replace(Regex.Replace(title ?? "", @"[\u200E\u200F\u202A-\u202E\u2066-\u2069]", ""), @"\s+", " ").Trim();
    }
    public class Player {
        public string Id, ListId;
        public bool HasNext, HasPrevious;
        public bool? Playing;
        public double? Position;
        public RangeValuePattern Volume;
        public AutomationElement VolumeControl;
    }
    public static Player ReadPlayer() {
        try {
            if (pinned == null) {
                var browser = DefaultBrowser();
                if (browser == null) return null;
                foreach (var window in Windows(browser)) {
                    var tab = Controls(window, ControlType.TabItem).FirstOrDefault(t => Selected(t) && YouTubeName(t.Current.Name));
                    if (tab == null) continue;
                    var bar = AddressBar(window);
                    if (bar == null || Address(bar) == null) continue;
                    pinned = tab; pinnedWindow = window; pinnedBar = bar;
                    break;
                }
            }
            if (pinned == null || !Selected(pinned)) return null;
            var uri = Address(pinnedBar);
            if (uri == null || uri.AbsolutePath != "/watch") return null;
            var id = Regex.Match(uri.Query, @"[?&]v=([a-zA-Z0-9_-]{11})(?:&|$)");
            if (!id.Success) return null;
            var result = new Player {Id=id.Groups[1].Value,ListId=Parameter(uri,"list","[A-Za-z0-9_-]{2,100}")};
            result.HasNext = TrackButton("next") != null;
            result.HasPrevious = TrackButton("prev") != null;
            var slider = pinnedWindow.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ClassNameProperty, "ytp-progress-bar"));
            var toggle = pinnedWindow.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ClassNameProperty, "ytp-play-button ytp-button"));
            result.VolumeControl = pinnedWindow.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ClassNameProperty, "ytp-volume-panel"));
            object pattern;
            if (result.VolumeControl != null && result.VolumeControl.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern))
                result.Volume = (RangeValuePattern)pattern;
            if (slider != null && slider.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern))
                result.Position = ((RangeValuePattern)pattern).Current.Value;
            if (toggle != null) {
                string label = toggle.Current.Name;
                if (label.StartsWith("Pause", StringComparison.OrdinalIgnoreCase)) result.Playing = true;
                else if (label.StartsWith("Play", StringComparison.OrdinalIgnoreCase)) result.Playing = false;
            }
            return result;
        } catch (ElementNotAvailableException) { pinned = null; return null; }
    }
    static readonly Dictionary<int,bool> regularProfiles = new Dictionary<int,bool>();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr handle, int command);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle, uint message, IntPtr key, IntPtr data);
    static AutomationElement[] Controls(AutomationElement root, ControlType type) {
        return root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, type))
            .Cast<AutomationElement>().Where(item => {
                for (var p = TreeWalker.ControlViewWalker.GetParent(item); p != null && !p.Equals(root); p = TreeWalker.ControlViewWalker.GetParent(p))
                    if (p.Current.ControlType == ControlType.Document) return false;
                return true;
            }).ToArray();
    }
    static bool Regular(int pid, string browser) {
        using (var proc = Process.GetProcessById(pid)) if (proc.ProcessName != browser) return false;
        bool result;
        if (!regularProfiles.TryGetValue(pid, out result)) {
            using (var process = new ManagementObject("Win32_Process.Handle='" + pid + "'")) {
                string args = Convert.ToString(process["CommandLine"]);
                result = args.Length > 0 && args.IndexOf("--user-data-dir", StringComparison.OrdinalIgnoreCase) < 0;
            }
            regularProfiles[pid] = result;
        }
        return result;
    }
    static List<AutomationElement> Windows(string browser) {
        var result = new List<AutomationElement>();
        foreach (AutomationElement win in AutomationElement.RootElement.FindAll(TreeScope.Children,
            new PropertyCondition(AutomationElement.ClassNameProperty, "Chrome_WidgetWin_1"))) {
            try { if (Regular(win.Current.ProcessId, browser)) result.Add(win); }
            catch (ArgumentException) {} catch (ElementNotAvailableException) {}
        }
        return result;
    }
    public static bool HasTarget(string mediaTitle) {
        if (pinned == null) {
            var browser = DefaultBrowser();
            if (browser == null) return false;
            foreach (var window in Windows(browser)) {
                var tab = Controls(window, ControlType.TabItem).FirstOrDefault(t =>
                    TitleKey(t.Current.Name).IndexOf(TitleKey(mediaTitle) + " - YouTube", StringComparison.OrdinalIgnoreCase) >= 0);
                if (tab == null) continue;
                var bar = AddressBar(window);
                if (bar == null || (Selected(tab) && Address(bar) == null)) continue;
                pinned = tab; pinnedWindow = window; pinnedBar = bar;
                break;
            }
            if (pinned == null) return false;
        }
        try { return TitleKey(pinned.Current.Name).IndexOf(TitleKey(mediaTitle) + " - YouTube", StringComparison.OrdinalIgnoreCase) >= 0; }
        catch (ElementNotAvailableException) { pinned = null; return false; }
    }
    public static bool IsPinned { get { return pinned != null; } }
    static bool YouTubeName(string name) {
        return Regex.IsMatch(name, @"(?:^| - )YouTube(?:$| - |,)", RegexOptions.IgnoreCase);
    }
    static Uri Address(AutomationElement bar) {
        var text = ((ValuePattern)bar.GetCurrentPattern(ValuePattern.Pattern)).Current.Value;
        Uri uri;
        return Uri.TryCreate(text.Contains("://") ? text : "https://" + text, UriKind.Absolute, out uri)
            && uri.Scheme == "https" && (uri.Host == "www.youtube.com" || uri.Host == "youtube.com") ? uri : null;
    }
    static AutomationElement AddressBar(AutomationElement window) {
        return Controls(window, ControlType.Edit).FirstOrDefault(e =>
            e.Current.AutomationId == "view_1017" || e.Current.ClassName == "OmniboxViewViews" ||
            e.Current.Name == "Address and search bar" || e.Current.Name == "Address and search field");
    }
    static bool Selected(AutomationElement tab) {
        return ((SelectionItemPattern)tab.GetCurrentPattern(SelectionItemPattern.Pattern)).Current.IsSelected;
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    public static void RequireVisiblePlayer() {
        if (pinnedWindow == null || pinned == null || !Selected(pinned) ||
            GetForegroundWindow() != new IntPtr(pinnedWindow.Current.NativeWindowHandle) || Address(pinnedBar) == null)
            throw new Exception("For this control in the background, connect Background controls in Glide YT on Windows.");
    }
    static bool Find(string browser, string path, string marker, bool localOpen) {
        var candidates = new List<Tuple<AutomationElement,AutomationElement>>();
        foreach (var win in Windows(browser))
            foreach (var tab in Controls(win, ControlType.TabItem))
                if ((pinned != null && pinned.Equals(tab)) || YouTubeName(tab.Current.Name)) candidates.Add(Tuple.Create(win,tab));
        foreach (var entry in candidates.OrderByDescending(e => pinned != null && pinned.Equals(e.Item2))
                                           .ThenByDescending(e => Selected(e.Item2))) {
            var window = entry.Item1;
            var tab = entry.Item2;
            if (marker != null && !Selected(tab)) continue;
            if (!localOpen && pinned != null && !pinned.Equals(tab)) continue;
            var handle = new IntPtr(window.Current.NativeWindowHandle);
            if (!localOpen && (GetForegroundWindow() != handle || !Selected(tab))) continue;
            if (localOpen && IsIconic(handle)) ShowWindowAsync(handle, 9);
            if (!Selected(tab)) ((SelectionItemPattern)tab.GetCurrentPattern(SelectionItemPattern.Pattern)).Select();
            var bar = AddressBar(window);
            if (bar == null) throw new Exception("Show the address bar in your browser and try again.");
            var uri = Address(bar);
            if (uri == null || (marker != null && uri.Fragment != marker)) {
                if (pinned != null && pinned.Equals(tab)) pinned = null;
                continue;
            }
            pinned = tab; pinnedWindow = window; pinnedBar = bar;
            if (localOpen) SetForegroundWindow(handle);
            if (path == null || uri.PathAndQuery == path) return true;
            if (!localOpen) RequireVisiblePlayer();
            bar.SetFocus();
            if (!Selected(tab) || Address(bar) == null) throw new Exception("The YouTube tab changed. Try again.");
            ((ValuePattern)bar.GetCurrentPattern(ValuePattern.Pattern)).SetValue("https://www.youtube.com" + path);
            if (!Selected(tab) || !bar.Current.HasKeyboardFocus) throw new Exception("Click the YouTube window once, then try again.");
            // Send Enter only to this browser window, even if another app takes foreground focus.
            if (!PostMessage(handle, 0x100, (IntPtr)13, (IntPtr)0x001C0001) ||
                !PostMessage(handle, 0x101, (IntPtr)13, (IntPtr)unchecked((int)0xC01C0001)))
                throw new Exception("The browser could not open the selected video.");
            return true;
        }
        return false;
    }
    public static string BrowserName() { return DefaultBrowser(); }
    static string DefaultBrowser() {
        string id = Convert.ToString(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice","ProgId",""));
        return id.StartsWith("MSEdge", StringComparison.OrdinalIgnoreCase) ? "msedge" :
            id.StartsWith("Chrome", StringComparison.OrdinalIgnoreCase) ? "chrome" : null;
    }
    public static object Open(string videoId) {
        if (videoId != null && !Regex.IsMatch(videoId, @"\A[A-Za-z0-9_-]{11}\z")) throw new Exception("Invalid video.");
        return Navigate(videoId == null ? null : "/watch?v=" + videoId, videoId == null);
    }
    static object Navigate(string path, bool localOpen = false) {
        string browser = DefaultBrowser();
        if (browser == null) throw new Exception("Same-tab control needs Edge or Chrome as your default browser.");
        if (Find(browser, path, null, localOpen)) return new {ok=true};
        if (!localOpen) throw new Exception("Connect Background controls in Glide YT on Windows to use the hidden YouTube tab.");
        string marker = "#lantube-" + Guid.NewGuid().ToString("N");
        Process.Start(new ProcessStartInfo("https://www.youtube.com" + (path ?? "/") + marker) {UseShellExecute=true});
        for (int i=0;i<15;i++) {
            Thread.Sleep(200);
            if (Find(browser, null, marker,true)) return new {ok=true};
        }
        throw new Exception("Waiting for YouTube. Let the tab finish opening before trying again.");
    }
}
