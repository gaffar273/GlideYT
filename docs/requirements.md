# Requirements and acceptance criteria

## Requested scope

- Windows laptop and Android phone communicate directly over the same home Wi-Fi.
- React Native Android application; primarily JavaScript across the project.
- Search for YouTube videos, select/change a video, play, and pause on the laptop.
- Every video selection replaces the video in the same controlled tab; never open another playback tab.
- One laptop background process and one Android application; minimal setup and dependencies.
- Reuse shared validation and transport code. Isolate browser-specific integration.
- No browser extension, extra Chromium distribution, Python runtime, cloud backend, or mandatory YouTube API key.

## Initial implementation choices

- Installed Chrome/Edge runs with one dedicated profile. This is a separate profile from everyday browsing because modern Chrome requires it for the debugging connection.
- A QR link opens Android with the laptop address and short code filled in. Manual pairing is available. Pairing persists. When DHCP changes the address, the phone can rediscover its paired laptop on the same private Wi-Fi.
- Phone is a remote for the Windows player. Playback in the official Android YouTube application and automatic cross-device handoff are not implemented.
- Search uses the YouTube page's public results format and can require maintenance. Account access, consent, autoplay, ads, and region/age restrictions remain governed by YouTube/browser behavior.
- Local HTTP is appropriate only on a trusted LAN. YouTube streaming still needs internet.

## Acceptance on actual hardware

1. Start the companion; open YouTube from setup; finish consent/sign-in manually if needed.
2. Install the Android release APK and pair with the displayed laptop address and code.
3. Search on the phone while a video plays: laptop video and tab stay unchanged.
4. Select a result: that same tab changes to the chosen video, with no extra playback tabs.
5. Play/pause from the phone and laptop: phone reflects the observed state within a few seconds. If the browser blocks initial autoplay, clicking Play once on the laptop is an expected setup step.
6. Background the phone: state polling stops; reopen it: polling resumes and reconnects.
7. Restart the companion: phone token is still valid. Closing the controlled tab requires explicit local recovery.
8. Revoke the phone from setup: its next authenticated request fails and it returns to pairing.
9. An unpaired device cannot read playback state, search, or control the browser.
10. Measure companion and browser memory separately on the target laptop; record device/model/build before setting a numerical RAM target.

## Development prerequisites

Companion: Windows 10/11, installed Chrome or Edge, Node >=22.11 (an LTS release recommended). No npm install is needed to run it.

Android: JDK 17; Android Studio/SDK platform 36, Build Tools 36.0.0, NDK 27.1.12297006; internet for npm and first Gradle build; Android 7+ phone (arm64 build default); USB debugging for development. The release APK bundles JavaScript and requires neither Metro nor USB during normal use.
