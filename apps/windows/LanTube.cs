using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

class LanTube {
    class Player { public bool connected { get; set; } public string title { get; set; } public string error { get; set; } }
    class Device {
        public string id { get; set; } public string name { get; set; }
        public bool connected { get; set; } public bool legacy { get; set; } public long createdAt { get; set; }
    }
    class Pair { public string code { get; set; } }
    class Status {
        public string[] addresses { get; set; } public Device[] devices { get; set; }
        public bool backgroundEnabled { get; set; } public Player state { get; set; } public Pair pairing { get; set; }
    }

    static readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly DispatcherTimer timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
    readonly Window window;
    Uri endpoint;
    string host, secret, code, qrLink, deviceKey;
    Device[] phones = new Device[0];
    bool refreshing, installMode, pairingRequested, acting;
    T UI<T>(string name) where T : FrameworkElement { return (T)window.FindName(name); }
    void Say(string message) { UI<TextBlock>("Notice").Text = message; }
    void Text(string name, string value) { UI<TextBlock>(name).Text = value; }

    [STAThread] static void Main() {
        if (Environment.GetCommandLineArgs().Contains("--companion")) {
            try { RunNode("scripts/launch-windows.mjs", null).GetAwaiter().GetResult(); }
            catch { Environment.ExitCode = 1; }
            return;
        }
        var app = new Application();
        try { app.Run(new LanTube().window); }
        catch (Exception ex) { MessageBox.Show(ex.GetBaseException().Message, "Glide YT"); }
    }
    LanTube() {
        using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("Window.xaml"))
            window = (Window)XamlReader.Load(resource);
        UI<Button>("CloseWindow").Click += (s,e) => window.Close();
        UI<Button>("MinimizeWindow").Click += (s,e) => window.WindowState = WindowState.Minimized;
        installMode = Environment.GetCommandLineArgs().Contains("--install");
        pairingRequested = installMode;
        window.Loaded += async (s,e) => {
            try {
                await RunNode("scripts/launch-windows.mjs", null);
                var dir = Environment.GetEnvironmentVariable("LAN_TUBE_DATA_DIR") ?? Path.Combine(root, ".local");
                var uri = new Uri(File.ReadAllText(Path.Combine(root, dir, "setup-url.txt")).Trim());
                if (uri.Host != "127.0.0.1" || uri.Scheme != "http" || uri.Fragment.Length != 65)
                    throw new Exception("Invalid companion settings. Restart Glide YT.");
                endpoint = new Uri(uri.GetLeftPart(UriPartial.Authority)); secret = uri.Fragment.Substring(1);
                await Refresh(); timer.Start();
            } catch (Exception ex) { Say("Unable to start. " + ex.Message); }
        };
        timer.Tick += async (s,e) => { if (window.WindowState != WindowState.Minimized) await Refresh(); };
        window.Closed += (s,e) => timer.Stop();
        UI<Button>("SwitchMode").Click += async (s,e) => { installMode = !installMode; await DrawCode(); };
        UI<Button>("Settings").Click += (s,e) => {
            bool show = UI<StackPanel>("SettingsPage").Visibility != Visibility.Visible;
            UI<StackPanel>("SettingsPage").Visibility = show ? Visibility.Visible : Visibility.Collapsed;
            UI<StackPanel>("Home").Visibility = show ? Visibility.Collapsed : Visibility.Visible;
            UI<Button>("Settings").Content = show ? "\uE711" : "\uE713"; Say("");
        };
        UI<Button>("PairAnother").Click += async (s,e) => { pairingRequested = true; installMode = false; await ShowPhone(); };
        UI<Button>("BackToPhone").Click += async (s,e) => { pairingRequested = false; installMode = false; await ShowPhone(); };
        Bind("Background","background"); Bind("Open","open"); Bind("Wifi","wifi"); Bind("Stop","stop");
    }

    static async Task<string> RunNode(string script, string input) {
        var bundledNode = Path.Combine(root, "runtime", "node.exe");
        var settings = new ProcessStartInfo(File.Exists(bundledNode) ? bundledNode : "node.exe", script) {
            CreateNoWindow = true, UseShellExecute = false, WorkingDirectory = root,
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true
        };
        using (var process = Process.Start(settings)) {
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            if (input != null) await process.StandardInput.WriteLineAsync(input);
            process.StandardInput.Close();
            await Task.WhenAll(output, error);
            await Task.Run(() => process.WaitForExit());
            if (process.ExitCode != 0) throw new Exception(error.Result.Trim());
            return output.Result.Trim();
        }
    }

    async Task<string> Api(string path, object body) {
        if (endpoint == null) throw new Exception("The companion is starting.");
        using (var client = new WebClient { Proxy = null, Encoding = Encoding.UTF8 }) {
            client.Headers["X-Admin-Secret"] = secret;
            var uri = new Uri(endpoint, "/admin/" + path);
            if (body == null) return await client.DownloadStringTaskAsync(uri);
            client.Headers["Content-Type"] = "application/json";
            try { return await client.UploadStringTaskAsync(uri, "POST", json.Serialize(body)); }
            catch (WebException ex) {
                if (ex.Response == null) throw;
                using (var reader = new StreamReader(ex.Response.GetResponseStream())) {
                    var details = json.Deserialize<System.Collections.Generic.Dictionary<string,string>>(reader.ReadToEnd());
                    throw new Exception(details["error"]);
                }
            }
        }
    }
    void Bind(string name, string path) {
        var button = UI<Button>(name);
        button.Click += async (s,e) => await Action(button, path, new object());
    }
    async Task Action(Button button, string path, object body) {
        if (acting) return;
        acting = true; button.IsEnabled = false; Say("");
        try {
            await Api(path, body);
            if (path == "stop") { window.Close(); return; }
            if (path == "background") Say("Background controls connected. Use Open YouTube to return to this window.");
            if (path == "wifi") Say("Private Wi-Fi access enabled.");
            await Refresh();
        } catch (Exception ex) { Say(ex.Message); }
        finally { acting = false; button.IsEnabled = true; }
    }
    async Task Refresh() {
        if (refreshing || endpoint == null) return;
        refreshing = true;
        try {
            var data = json.Deserialize<Status>(await Api("status", null));
            Text("Status", data.state.connected ? "Connected" : "Idle");
            Text("Playing", data.state.connected ? data.state.title ?? "Ready to play" : data.state.error);
            UI<Button>("Background").Content = data.backgroundEnabled ? "Open background player" : "Set up background controls";
            if (deviceKey != null && data.devices.Any(d => d.connected && !phones.Any(p => p.id == d.id && p.connected))) {
                pairingRequested = false; installMode = false;
            }
            phones = data.devices;
            code = data.pairing.code;
            host = data.addresses.Select(a => new Uri(a).Authority).FirstOrDefault();
            UI<TextBox>("Address").Text = host ?? "Connect to Wi-Fi";
            var key = json.Serialize(data.devices);
            if (key != deviceKey) {
                var list = UI<StackPanel>("Devices"); list.Children.Clear();
                if (data.devices.Length == 0) list.Children.Add(new TextBlock { Text = "No paired phones", Margin = new Thickness(0,4,0,8) });
                var earlier = new StackPanel();
                foreach (var device in data.devices) {
                    var label = "Remove " + device.name;
                    if (device.legacy) {
                        var paired = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(device.createdAt).ToLocalTime();
                        label += " · " + paired.ToString("g");
                    }
                    var button = new Button { Content = label, HorizontalAlignment = HorizontalAlignment.Left };
                    button.Click += async (s,e) => await Action(button, "revoke", new { deviceId = device.id });
                    (device.legacy ? earlier : list).Children.Add(button);
                }
                if (earlier.Children.Count > 0)
                    list.Children.Add(new Expander { Header = "Earlier pairings (" + earlier.Children.Count + ")", Content = earlier, Margin = new Thickness(0,8,0,4) });
                deviceKey = key;
            }
        } catch (Exception ex) {
            Text("Status", "Offline");
            foreach (var phone in phones) phone.connected = false;
            host = null; code = null;
            Say(ex.Message);
        }
        try { await ShowPhone(); }
        finally { refreshing = false; }
    }
    async Task ShowPhone() {
        bool pair = phones.Length == 0 || pairingRequested;
        UI<Border>("PairCard").Visibility = pair ? Visibility.Visible : Visibility.Collapsed;
        UI<Border>("PhoneCard").Visibility = pair ? Visibility.Collapsed : Visibility.Visible;
        UI<Button>("BackToPhone").Visibility = phones.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        if (pair) { await DrawCode(); return; }
        qrLink = null; UI<Image>("QR").Source = null; Text("Code", "");
        var online = phones.Where(d => d.connected).ToArray();
        var shown = online.Length > 0 ? online : phones.OrderByDescending(d => d.createdAt).Take(1).ToArray();
        Text("PhoneNames", String.Join(", ", shown.Select(d => d.name)));
        Text("PhoneStatus", online.Length > 0 ? "Connected" : "Disconnected");
        UI<Border>("PhoneShape").Opacity = online.Length > 0 ? 1.0 : 0.45;
    }
    async Task DrawCode() {

        Text("PairHeading", installMode ? "Install Android app" : "Pair your phone");
        Text("Hint", installMode ? "Scan with your phone camera to download the latest Android app." : host == null ? "Connect your laptop to Wi-Fi." : "Open Glide YT on your phone and tap Scan QR code.");
        Text("Code", installMode || code == null ? "" : code.Insert(3, " "));
        UI<TextBlock>("Code").Visibility = installMode ? Visibility.Collapsed : Visibility.Visible;
        UI<Button>("SwitchMode").Content = installMode ? "Show pairing code" : "Install Android app";
        var image = UI<Image>("QR");
        var link = installMode ? "https://github.com/gaffar273/GlideYT/releases/latest/download/GlideYT-Android.apk"
            : host == null || code == null ? null : "lantube://pair/" + host + "/" + code;
        if (link == qrLink) return;
        qrLink = link; image.Source = null;
        if (link == null) return;
        try {
            var rows = (await RunNode("apps/windows/qr.cjs", link)).Split(new[] {'\r','\n'}, StringSplitOptions.RemoveEmptyEntries);
            if (link != qrLink) return;
            int size = rows.Length + 8;
            var pixels = Enumerable.Repeat((byte)255, size * size).ToArray();
            for (int y = 0; y < rows.Length; y++)
                for (int x = 0; x < rows.Length; x++)
                    if (rows[y][x] == '1') pixels[(y+4)*size+x+4] = 0;
            image.Source = BitmapSource.Create(size,size,96,96,PixelFormats.Gray8,null,pixels,size);
        } catch (Exception ex) { if (link == qrLink) { qrLink = null; Say(ex.Message); } }
    }
}
