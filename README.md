# Glide YT

Control YouTube on a Windows laptop from an Android phone over home Wi-Fi. The Windows app uses WPF and starts a small Node companion in the background. The phone uses a standalone React Native app. Chrome or Edge opens when you choose **Open YouTube**.

## Downloads and support

[Download for Windows](https://github.com/gaffar273/GlideYT/releases/latest/download/GlideYT-Setup.exe) · [Download for Android](https://github.com/gaffar273/GlideYT/releases/latest/download/GlideYT-Android.apk) · [Setup guide](https://agslabs.tech/product/glideYT#guide) · [Report an issue](https://github.com/gaffar273/GlideYT/issues)

Run **GlideYT-Setup.exe** on a 64-bit Windows PC and open **GlideYT** from Start. Setup installs the companion, the Node.js runtime and the signed Android APK for your Windows account. Use Edge or Chrome for YouTube. See the [Windows troubleshooting guide](https://agslabs.tech/troubleshooting/windows) for download and installation warnings.

## Get started

1. Open **GlideYT** from Start. If you are running the source checkout, install Node.js 22.11 or later and use **Start-GlideYT.cmd**.
2. Choose **Install Android app** and scan the QR code with the phone camera. Install the APK. You can also transfer `dist/android/glide-yt-0.1.0.apk` by USB. The APK supports arm64 phones running Android 7 or later.
3. Choose **Show pairing code** on Windows. Tap **Scan QR code** inside the Android app and point it at the laptop. For manual pairing, find the address under the gear icon in Windows. Both devices must use the same trusted Wi-Fi.
4. Choose **Open YouTube** on Windows. Search on the phone and tap a video to play it on the laptop. The remote shows artwork, title, playback time, play/pause, and ten-second skips.

After pairing, the phone remembers the laptop. Closing the Windows window frees its UI memory and keeps playback control available. Reopen Glide YT for pairing or settings. **Devices and settings** lets you remove a phone, allow private Wi-Fi access, or stop the companion.

With version 0.1.2 on both devices, pairing the same phone again updates its entry. Open the updated Android app once to identify an existing pairing by phone model. Windows groups older, unidentified entries under **Earlier pairings**, where you can remove them by pairing date.

Development builds use Node 22.11+ and npm workspaces. Windows opens YouTube in your default browser and uses its system media session for playback. Start a video once if the browser has not yet exposed its controls. Diagnostics and local credentials are in the private `.local` directory. The Windows executable can be rebuilt with `apps/windows/build.ps1`.

### Background controls

Play, pause and seek use Windows media sessions while another window or tab is active. For playlist navigation, quality, speed and volume in a hidden YouTube tab, enable remote debugging in the default browser's inspect page. In Glide YT on Windows, choose the gear and **Connect background controls**, then approve the browser prompt. The companion attaches to the existing YouTube tab. Repeat Connect after restarting the browser or companion. Phone commands never initiate a debugging connection.

## Build the Android app

On Windows, the automated path is **Setup-Android.cmd**, followed by **Build-Android.cmd**, run from a normal terminal with internet access. Setup downloads a checksum-verified portable JDK 17 and SDK command-line tools into `.local/toolchain`, then lets you review Google's SDK/package licenses interactively. It does not alter global environment variables or require Android Studio. The SDK manager version is pinned to 19.0 for JDK 17 compatibility; SDK platform/build tools remain version 36. Building installs npm dependencies, runs checks, builds a standalone personal-use APK, and copies it to `dist/android/glide-yt-0.1.0.apk` with a SHA-256 build report. A failed build never creates a successful build report. Initial SDK/NDK/Gradle downloads can consume several GB of disk space; these tools are only for building, not required for running the companion.

The setup script reuses a complete existing SDK when available. SDK license terms are provided by [Google](https://developer.android.com/studio#terms-and-conditions); portable JDK releases/checksums come from [Adoptium](https://adoptium.net/installation/archives).

Manual alternative: this is a bare React Native project, not Expo. Install JDK 17 and Android Studio, including SDK platform 36, Build Tools 36.0.0, NDK 27.1.12297006, and platform-tools. Set `JAVA_HOME` and `ANDROID_HOME` and put platform-tools on PATH. See the [official environment setup](https://reactnative.dev/docs/set-up-your-environment).

```powershell
npm.cmd run doctor
npm.cmd install
npm.cmd run metro
```

In a second terminal, with an Android phone connected over USB and USB debugging enabled:

```powershell
adb reverse tcp:8081 tcp:8081
npm.cmd run android
```

For an emulator, add `-PreactNativeArchitectures=x86_64` to a direct Gradle build or update `reactNativeArchitectures` in `apps/android/android/gradle.properties`. The default is arm64 to reduce build time and APK size.

For an APK that runs without Metro or USB:

```powershell
cd apps/android/android
.\gradlew.bat assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

The first Gradle invocation downloads the official wrapper JAR and validates it against Gradle's published SHA-256 checksum. Local test builds default to the Android debug key. To reproduce a public build, set GLIDEYT_KEYSTORE to the distribution PKCS12 file (alias glideyt) and GLIDEYT_SIGNING_PASSWORD to its password in the build process environment. Run Build-Android.cmd, then scripts/package-windows.ps1. Every public update must use the same key. An earlier debug-signed installation must be uninstalled before installing the public APK. APK builds and npm installs require internet. `package-lock.json` records the installed dependency versions. The build script verifies the APK signature, application identity, and embedded Hermes bytecode before writing a successful build report.

## Pair and use

1. Connect laptop and phone to the same trusted home Wi-Fi.
2. Tap **Scan QR code** in the Android app and scan the Windows pairing code.
3. Search and tap a result to play it on the laptop. Search does not navigate away from the current video. Opening YouTube again brings its tab forward. Selecting a result navigates that tab. If it was closed, Glide YT looks for an existing YouTube tab before opening one.
4. Use Play/Pause or ±10 seconds. Pull down the Android notification shade to pause, resume or skip while using another app.

The pairing code expires after five minutes and changes after use. Pairing tokens persist across restarts and can be revoked on the laptop. If the laptop's Wi-Fi address changes, reconnect by pairing again. For initial browser autoplay restrictions, click Play on the laptop once. Choose **Open YouTube** to open YouTube again.

If pairing cannot reach the laptop, check the IP, port, and whether your router isolates Wi-Fi clients. The Windows app's **Allow Wi-Fi access** button requests Windows administrator approval for a narrow Private-profile rule; it cannot approve the Windows prompt itself. No rule is changed automatically at startup. Do not expose the companion port through your router. Local HTTP is unencrypted: use trusted Wi-Fi only. Streaming YouTube requires internet; controls have no cloud dependency.

## Project structure

```text
apps/
  companion/
    src/                 HTTP API, pairing, browser/CDP, YouTube adapter
    public/              Optional Android download page
  windows/               WPF companion window and local QR rendering
  android/
    src/                 React Native pairing and remote screens
    android/             Native project and Keystore-backed session storage
packages/core/           Shared commands, validation, HTTP client, formatting
scripts/                 Windows launch, doctor, checks, Gradle bootstrap, browser smoke
tests/                   Node built-in tests; no test dependencies
docs/                    Requirements, architecture, acceptance criteria
```

Read [system design](docs/design.md) and [requirements](docs/requirements.md) for the API and tradeoffs. Android configuration follows the [React Native 0.84 community template](https://github.com/react-native-community/template/tree/0.84-stable/template), with unnecessary sample screens and test/lint packages omitted.

## Validation

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run doctor
node scripts/smoke-browser.mjs
npm.cmd run test:youtube
```

Tests cover pairing persistence/expiry/revocation/rate limiting, HTTP authorization and Origin checks, bounded inputs, YouTube result parsing, CDP failure handling, and navigation of the same target. The browser smoke uses local synthetic video/search fixtures through a real Edge/Chrome CDP connection. `test:youtube` separately checks live public YouTube search, selection, and play/pause in an unsigned browser profile. Edge may expose its internal sync-confirmation dialog as a separate debugging target; tests count playback tabs independently of that internal dialog.

The managed JDK/SDK and Gradle caches are installed in `.local`; no global environment changes are required. See [validation status](docs/validation.md) for actual results and remaining phone checks. Google account login and real Android hardware behavior have not been tested. Follow the device acceptance checklist before calling this ready for daily use.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `LAN_TUBE_PORT` | `3210` | Companion LAN HTTP port |
| `LAN_TUBE_CDP_PORT` | `9223` | Browser loopback-only debugging port |
| `LAN_TUBE_BROWSER` | Installed Chrome, then Edge | Full path to browser executable |
| `LAN_TUBE_DATA_DIR` | `.local` in this project | Local browser profile and paired-device hashes |

Search currently parses YouTube's public results page inside the browser. That integration is isolated in `youtube-page.mjs` because YouTube's website can change. Consent, verification, and parser failures are reported to the phone. No videos are downloaded, no ads or account protections are bypassed, and no Google credentials are sent to the companion or phone app.
