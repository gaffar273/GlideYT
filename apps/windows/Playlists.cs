using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

static partial class YouTubeTab {
    class PlaylistLink {
        public string listId {get;set;}
        public string videoId {get;set;}
        public string thumbnail {get {return videoId == null ? null : "https://i.ytimg.com/vi/"+videoId+"/mqdefault.jpg";}}
        public int index {get;set;}
        public string title {get;set;}
    }
    static AutomationElement lastEpisode;
    static string episodeListId;
    static List<PlaylistLink> episodeRows = new List<PlaylistLink>();
    static string Parameter(Uri url, string name, string expression) {
        var match = Regex.Match(url.Query, "[?&]" + name + "=(" + expression + ")(?:&|$)");
        return match.Success ? match.Groups[1].Value : null;
    }
    static Uri LinkAddress(AutomationElement link) {
        object value; Uri url;
        if (link.TryGetCurrentPattern(ValuePattern.Pattern, out value) &&
            Uri.TryCreate(((ValuePattern)value).Current.Value,UriKind.Absolute,out url) &&
            url.Scheme == "https" && url.Host == "www.youtube.com") return url;
        return null;
    }
    static AutomationElement TrackButton(string direction) {
        var name = "ytp-" + direction + "-button ytp-button";
        var condition = new OrCondition(new PropertyCondition(AutomationElement.ClassNameProperty, name),
            new PropertyCondition(AutomationElement.ClassNameProperty, name + " ytp-playlist-ui"));
        var button = pinnedWindow.FindFirst(TreeScope.Descendants,condition);
        return button != null && button.Current.IsEnabled ? button : null;
    }
    public static object Skip(bool forward) {
        RequireVisiblePlayer();
        var button = TrackButton(forward ? "next" : "prev");
        if (button == null) throw new Exception(forward ? "YouTube has no next video." : "This is the first playlist video.");
        object invoke;
        if (!button.TryGetCurrentPattern(InvokePattern.Pattern, out invoke)) throw new Exception("YouTube cannot skip this video yet.");
        ((InvokePattern)invoke).Invoke();
        return new {ok=true};
    }
    static List<PlaylistLink> ReadLinks(string onlyList) {
        var result = new List<PlaylistLink>();
        foreach (AutomationElement link in pinnedWindow.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Hyperlink))) {
            try {
                var url = LinkAddress(link);
                if (url == null || (url.AbsolutePath != "/watch" && url.AbsolutePath != "/playlist")) continue;
                var id = Parameter(url,"list","[A-Za-z0-9_-]{2,100}");
                var video = Parameter(url,"v","[A-Za-z0-9_-]{11}");
                if (id == null || (onlyList != null && (id != onlyList || video == null))) continue;
                var name = link.Current.Name.Trim();
                int index;
                int.TryParse(Parameter(url,"index","[0-9]{1,6}"),out index);
                if (onlyList != null) {
                    if (name.Length == 0 || name == "Resume" || name == "Play all" || name == "Shuffle") continue;
                    lastEpisode = link;
                }
                var row = result.FirstOrDefault(r => r.listId == id && (onlyList == null || (r.videoId == video && r.index == index)));
                if (row == null) { row = new PlaylistLink {listId=id,index=index}; result.Add(row); }
                if (string.IsNullOrEmpty(row.title) || row.title == "View full playlist" || row.title == "Play all" || Regex.IsMatch(row.title, @"^[\d: ]+$")) row.title = name;
                if (row.videoId == null) row.videoId = video;
            } catch (ElementNotAvailableException) {}
        }
        return result;
    }
    static List<PlaylistLink> RecommendedVideos(string currentVideo) {
        var result = new List<PlaylistLink>();
        if (currentVideo == null) return result;
        var section = pinnedWindow.FindFirst(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, "related"));
        if (section == null) return result;
        var seen = new HashSet<string>();
        foreach (AutomationElement link in section.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink))) {
            try {
                var url = LinkAddress(link);
                if (url == null || url.AbsolutePath != "/watch" || Parameter(url,"list","[A-Za-z0-9_-]+") != null) continue;
                var id = Parameter(url,"v","[A-Za-z0-9_-]{11}");
                var title = link.Current.Name.Trim();
                if (id == null || id == currentVideo || title.Length == 0 || Regex.IsMatch(title,@"^[\d:\s]+$") || !seen.Add(id)) continue;
                result.Add(new PlaylistLink {videoId=id,title=title});
                if (result.Count == 50) break;
            } catch (ElementNotAvailableException) {}
        }
        return result;
    }
    static bool PageReady(string path) {
        var address = Address(pinnedBar);
        if (address == null || address.PathAndQuery != path) return false;
        var doc = pinnedWindow.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
        var url = doc == null ? null : LinkAddress(doc);
        return url != null && url.PathAndQuery == path;
    }
    static List<PlaylistLink> OpenPage(string path,string onlyList) {
        Navigate(path);
        List<PlaylistLink> latest = new List<PlaylistLink>();
        int stable = 0;
        for (int i=0; i<24; i++) {
            Thread.Sleep(200);
            if (!PageReady(path)) continue;
            var rows = ReadLinks(onlyList);
            if (onlyList != null && rows.Count > 0) return rows;
            stable = rows.Count > 0 && rows.Count == latest.Count ? stable+1 : 0;
            latest = rows;
            if (stable >= 4 && rows.Any(r => r.videoId != null)) break;
        }
        return latest;
    }
    public static object Playlists(bool saved) {
        List<PlaylistLink> rows;
        if (saved) rows = OpenPage("/feed/playlists",null);
        else {
            RequireVisiblePlayer();
            var url = Address(pinnedBar);
            rows = ReadLinks(null);
            var seed = url == null ? null : Parameter(url,"v","[A-Za-z0-9_-]{11}");
            if (seed != null && !rows.Any(r => r.listId == "RD"+seed))
                rows.Insert(0,new PlaylistLink {listId="RD"+seed,videoId=seed,title="YouTube Mix · current video"});
            rows.InsertRange(0, RecommendedVideos(seed));
        }
        return new {playlists=rows.Where(r => !String.IsNullOrWhiteSpace(r.title)).Take(100).ToArray()};
    }
    public static object Episodes(string id,string seed,bool more) {
        if (!Regex.IsMatch(id ?? "",@"\A[A-Za-z0-9_-]{2,100}\z")) throw new Exception("Invalid playlist.");
        if (seed != null && !Regex.IsMatch(seed,@"\A[A-Za-z0-9_-]{11}\z")) throw new Exception("Invalid video.");
        if (more) RequireVisiblePlayer();
        if (more && (episodeListId != id || pinnedBar == null || !Selected(pinned) ||
            Address(pinnedBar) == null || Parameter(Address(pinnedBar),"list","[A-Za-z0-9_-]{2,100}") != id))
            throw new Exception("Reopen this playlist to load more episodes.");
        if (!more) {
            lastEpisode = null;
            episodeListId = id;
            string path = id.StartsWith("RD") && seed != null ? "/watch?v="+seed+"&list="+id : "/playlist?list="+id;
            episodeRows = OpenPage(path,id);
        } else if (lastEpisode != null) {
            object pattern;
            if (lastEpisode.TryGetCurrentPattern(ScrollItemPattern.Pattern,out pattern)) ((ScrollItemPattern)pattern).ScrollIntoView();
        }
        int before = episodeRows.Count;
        for (int i=0;i<(more ? 12 : 3);i++) {
            Thread.Sleep(150);
            foreach (var row in ReadLinks(id))
                if (!episodeRows.Any(r => r.videoId == row.videoId && r.index == row.index)) episodeRows.Add(row);
            if (more) RequireVisiblePlayer();
        if (more && episodeRows.Count > before) break;
        }
        return new {episodes=episodeRows,hasMore=episodeRows.Count > 0 && (more ? episodeRows.Count > before : episodeRows.Count >= 20)};
    }
    public static object PlayList(string id,string video,int index) {
        if (!Regex.IsMatch(id ?? "",@"\A[A-Za-z0-9_-]{2,100}\z")) throw new Exception("Invalid playlist.");
        if (video == null) {
            var first = OpenPage("/playlist?list="+id,id).FirstOrDefault();
            if (first == null) throw new Exception("No playable videos were found in this playlist.");
            video = first.videoId;
        }
        if (!Regex.IsMatch(video,@"\A[A-Za-z0-9_-]{11}\z")) throw new Exception("Invalid playlist video.");
        return Navigate("/watch?v="+video+"&list="+id+(index > 0 ? "&index="+index : ""));
    }
}
