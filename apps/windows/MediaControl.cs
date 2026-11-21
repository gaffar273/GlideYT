using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Windows.Media.Control;

class MediaControl {
    class Request {
        public string type { get; set; }
        public int index { get; set; }
        public string listId { get; set; }
        public string option { get; set; }
        public double level { get; set; }
        public double seconds { get; set; }
        public string title { get; set; }
        public string videoId { get; set; }
    }
    delegate bool WindowVisitor(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisitor visitor, IntPtr parameter);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder title, int length);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static GlobalSystemMediaTransportControlsSessionManager manager;
    static string lastTitle, lastSource;
    static bool Browser(string name) {
        return new[]{"msedge","chrome","firefox","brave","opera","vivaldi"}.Any(x => name.IndexOf(x, StringComparison.OrdinalIgnoreCase) >= 0);
    }
    static bool VisibleYouTube(string title) {
        bool found = false;
        EnumWindows(delegate(IntPtr handle, IntPtr unused) {
            if (!IsWindowVisible(handle)) return true;
            var text = new StringBuilder(1024);
            GetWindowText(handle, text, text.Capacity);
            if (YouTubeTab.TitleKey(text.ToString()).IndexOf(YouTubeTab.TitleKey(title) + " - YouTube", StringComparison.OrdinalIgnoreCase) < 0) return true;
            uint pid; GetWindowThreadProcessId(handle, out pid);
            try { using (var process = Process.GetProcessById((int)pid)) found = Browser(process.ProcessName); }
            catch (ArgumentException) {}
            return !found;
        }, IntPtr.Zero);
        return found;
    }
    static T Result<T>(Windows.Foundation.IAsyncOperation<T> operation) {
        var timer = Stopwatch.StartNew();
        while (operation.Status == Windows.Foundation.AsyncStatus.Started) {
            if (timer.ElapsedMilliseconds > 3500) { operation.Cancel(); throw new Exception("Windows media controls timed out."); }
            System.Threading.Thread.Sleep(8);
        }
        return operation.GetResults();
    }
    static double Position(GlobalSystemMediaTransportControlsSessionTimelineProperties timeline, bool playing, double? rate) {
        double seconds = timeline.Position.TotalSeconds;
        if (playing && timeline.LastUpdatedTime.Year > 2000)
            seconds += Math.Max(0, (DateTimeOffset.UtcNow - timeline.LastUpdatedTime).TotalSeconds) * (rate ?? 1);
        return Math.Max(0, Math.Min(seconds, timeline.EndTime.TotalSeconds));
    }
    static object Handle(Request request) {
        if (request.type == "browser") return YouTubeTab.BrowserName();
        if (request.type == "open" || request.type == "select") return YouTubeTab.Open(request.type == "select" ? request.videoId : null);
        if (request.type == "saved" || request.type == "suggested") return YouTubeTab.Playlists(request.type == "saved");
        if (request.type == "episodes" || request.type == "moreEpisodes") return YouTubeTab.Episodes(request.listId,request.videoId,request.type == "moreEpisodes");
        if (request.type == "playlist") return YouTubeTab.PlayList(request.listId, request.videoId,request.index);

        if (manager == null) manager = Result(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
        var tab = YouTubeTab.ReadPlayer();
        if (request.type == "speed" || request.type == "quality") {
            if (tab == null) throw new Exception("Show the YouTube tab on your laptop to change this setting.");
            return YouTubeTab.Settings(request.type, request.option);
        }
        GlobalSystemMediaTransportControlsSession chosen = null;
        string chosenTitle = null;
        double best = double.PositiveInfinity;
        foreach (var session in manager.GetSessions()) {
            var source = session.SourceAppUserModelId ?? "";
            if (!Browser(source)) continue;
            var metadata = Result(session.TryGetMediaPropertiesAsync());
            var title = metadata.Title;
            if (String.IsNullOrWhiteSpace(title)) continue;
            bool selected = String.Equals(YouTubeTab.TitleKey(request.title), YouTubeTab.TitleKey(title), StringComparison.OrdinalIgnoreCase);
            bool matchesTab = YouTubeTab.HasTarget(title);
            if (YouTubeTab.IsPinned ? !matchesTab : !selected && !(source == lastSource && title == lastTitle) && !VisibleYouTube(title)) continue;
            var info = session.GetPlaybackInfo();
            var time = session.GetTimelineProperties();
            bool running = info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            double score = tab != null && tab.Position.HasValue ? Math.Abs(Position(time, running, info.PlaybackRate) - tab.Position.Value) : 0;
            if (tab != null && tab.Playing.HasValue && running != tab.Playing.Value) score += 1000000;
            if (score < best) { best = score; chosen = session; chosenTitle = title; }
        }
        if (chosen != null) {
            var session = chosen;
            string title = chosenTitle;
            lastTitle = title; lastSource = session.SourceAppUserModelId;
            bool ok = true;
            switch(request.type) {
                case "next": case "previous": {
                    bool next = request.type == "next";
                    var controls = session.GetPlaybackInfo().Controls;
                    if (next ? controls.IsNextEnabled : controls.IsPreviousEnabled)
                        ok = next ? Result(session.TrySkipNextAsync()) : Result(session.TrySkipPreviousAsync());
                    else return YouTubeTab.Skip(next);
                    break;
                }
                case "volume": YouTubeTab.SetVolume(tab, request.level); break;
                case "play": ok = Result(session.TryPlayAsync()); break;
                case "pause": ok = Result(session.TryPauseAsync()); break;
                case "seek": ok = Result(session.TryChangePlaybackPositionAsync(TimeSpan.FromSeconds(request.seconds).Ticks)); break;
                case "state": break;
                default: throw new Exception("This playback control is unavailable.");
            }
            if (!ok) throw new Exception("The browser could not apply that playback control.");
            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();
            bool playing = playback.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            var duration = timeline.EndTime.TotalSeconds;
            var position = Position(timeline, playing, playback.PlaybackRate);
            string id = tab != null ? tab.Id : YouTubeTab.TitleKey(request.title) == YouTubeTab.TitleKey(title) ? request.videoId : null;
            return new {connected=true,ready=true,title=title,videoId=id ?? "windows-session",playing=playing, volume=tab != null && tab.Volume != null ? (double?)(tab.Volume.Current.Value / 100) : null,
                listId=tab == null ? null : tab.ListId, hasNext=playback.Controls.IsNextEnabled || (tab != null && tab.HasNext), hasPrevious=playback.Controls.IsPreviousEnabled || (tab != null && tab.HasPrevious),
                live=!playback.Controls.IsPlaybackPositionEnabled, position=Math.Max(0,Math.Min(position,duration)),duration=duration,
                thumbnail=id == null ? null : "https://i.ytimg.com/vi/"+id+"/mqdefault.jpg"};
        }
        if (request.type != "state") throw new Exception("Play a YouTube video in your browser first.");
        return new {connected=true,ready=false,playing=false,title="Choose a video",duration=0,position=0};
    }
    static void Main() {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        string line;
        while ((line = Console.ReadLine()) != null) {
            try { Console.WriteLine(json.Serialize(new {result=Handle(json.Deserialize<Request>(line))})); }
            catch (Exception ex) { Console.WriteLine(json.Serialize(new {error=ex.Message})); }
        }
    }
}
