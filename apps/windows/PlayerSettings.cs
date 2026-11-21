using System;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

static partial class YouTubeTab {
    public static void SetVolume(Player player, double level) {
        if (player == null || player.Volume == null)
            throw new Exception("Show the YouTube tab on your laptop to change its volume.");
        var control = player.VolumeControl;
        var range = player.Volume;
        double desired = Math.Round(level * 100);
        var handle = new IntPtr(pinnedWindow.Current.NativeWindowHandle);
        RequireVisiblePlayer();
        control.SetFocus();
        for (int step = 0; step < 20; step++) {
            double current = range.Current.Value;
            if (Math.Abs(current - desired) < 2.51) return;
            if (!Selected(pinned) || Address(pinnedBar) == null)
                throw new Exception("The YouTube volume control lost focus. Try again.");
            var key = (IntPtr)(current < desired ? 38 : 40);
            PostMessage(handle, 0x100, key, (IntPtr)1);
            PostMessage(handle, 0x101, key, (IntPtr)unchecked((int)0xC0000001));
            for (int i=0; i<20 && range.Current.Value == current; i++) Thread.Sleep(15);
            if (range.Current.Value == current) throw new Exception("YouTube did not change the volume.");
        }
    }

    static AutomationElement FindPlayerControl(ControlType type, Func<AutomationElement,bool> match) {
        return pinnedWindow.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, type))
            .Cast<AutomationElement>().FirstOrDefault(match);
    }
    static AutomationElement WaitControl(ControlType type, Func<AutomationElement,bool> match) {
        for (int i=0; i<15; i++) {
            var element = FindPlayerControl(type,match);
            if (element != null) return element;
            Thread.Sleep(40);
        }
        throw new Exception("This option is unavailable in the current YouTube player.");
    }
    static ExpandCollapsePattern Expandable(AutomationElement e) {
        return (ExpandCollapsePattern)e.GetCurrentPattern(ExpandCollapsePattern.Pattern);
    }
    static string QualityName(AutomationElement e) {
        var name = e.Current.Name;
        if (name.IndexOf("Premium",StringComparison.OrdinalIgnoreCase)>=0) return "";
        return Regex.Match(name, @"^(Auto|[1-9]\d{1,3}p(?:\d{2,3})?)\b").Value;
    }
    public static object Settings(string type, string option) {
        RequireVisiblePlayer();
        var button = WaitControl(ControlType.Button, e => e.Current.ClassName.Contains("ytp-settings-button"));
        var menu = Expandable(button);
        try {
            if (menu.Current.ExpandCollapseState == ExpandCollapseState.Expanded) {
                menu.Collapse(); Thread.Sleep(120);
            }
            menu.Expand();
            string label = type == "quality" ? "Quality" : "Playback speed";
            var item = WaitControl(ControlType.MenuItem, e => e.Current.ClassName.Contains("ytp-menuitem") &&
                e.Current.Name.StartsWith(label, StringComparison.OrdinalIgnoreCase));
            Expandable(item).Expand();
            if (type == "speed") {
                var slider = WaitControl(ControlType.Slider,e => e.Current.ClassName.Contains("ytp-speedslider"));
                var range = (RangeValuePattern)slider.GetCurrentPattern(RangeValuePattern.Pattern);
                var choices = new[]{"0.5","0.75","1","1.25","1.5","2"}.Where(x => {
                    double n = double.Parse(x,CultureInfo.InvariantCulture);
                    return n >= range.Current.Minimum && n <= range.Current.Maximum;
                }).ToArray();
                if (option != null) {
                    if (!choices.Contains(option)) throw new Exception("That speed is unavailable.");
                    double desired = double.Parse(option,CultureInfo.InvariantCulture);
                    range.SetValue(desired);
                    for (int i=0; i<20 && Math.Abs(range.Current.Value-desired)>0.01; i++) Thread.Sleep(25);
                    if (Math.Abs(range.Current.Value-desired)>0.01) throw new Exception("YouTube did not apply that speed.");
                }
                return new {options=choices,current=range.Current.Value.ToString("0.##",CultureInfo.InvariantCulture)};
            }
            WaitControl(ControlType.RadioButton,e => e.Current.ClassName.Contains("ytp-menuitem") && (option == null ? QualityName(e) != "" : QualityName(e) == option));
            Thread.Sleep(160);
            var rows = pinnedWindow.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.RadioButton))
                .Cast<AutomationElement>().Where(e => e.Current.ClassName.Contains("ytp-menuitem") && QualityName(e) != "").ToArray();
            var names = rows.Select(QualityName).Distinct().ToArray();
            var selected = rows.FirstOrDefault(e => ((SelectionItemPattern)e.GetCurrentPattern(SelectionItemPattern.Pattern)).Current.IsSelected);
            string current = selected == null ? null : QualityName(selected);
            if (option != null) {
                var row = rows.FirstOrDefault(e => QualityName(e) == option);
                if (row == null) throw new Exception("That resolution is unavailable for this video.");
                ((InvokePattern)row.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
                current = option;
            }
            return new {options=names,current=current};
        } finally {
            if (menu.Current.ExpandCollapseState == ExpandCollapseState.Expanded) { menu.Collapse(); Thread.Sleep(280); }
        }
    }
}
