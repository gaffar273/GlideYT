# Validation status

**Ready for personal-device testing.** Native Android compilation and laptop/browser integration checks pass. A physical Android phone has not yet been used for acceptance testing.

## Built artifact

- `dist/android/glide-yt-0.1.3.apk`.
- `assembleRelease` completed successfully, including native Kotlin/C++, Android resource checks, R8 shrinking, and packaging.
- APK signature verified with Android SDK `apksigner` (v2 signing, GlideYT distribution certificate for the public APK).
- Application ID: `com.lantube`; Android API 24 minimum, API 36 target; arm64-v8a.
- Embedded Hermes bytecode verified. No Metro server or USB connection is required to run the installed release.
- SHA-256 and metadata are recorded in `dist/android/build-report.json`.

## Automated and live checks

- All 29 Node tests pass, including authentication, pairing expiry/persistence/revocation, bounded commands, download integrity, same-target navigation, explicit local tab recovery, and safe APK serving.
- JavaScript/JSON checks and React Native Babel transformation pass.
- The actual companion entry point starts and its authenticated stop action exits cleanly.
- A real Edge fixture test passes playback, pause, search without navigation, same-tab selection, and command state feedback.
- Live public YouTube search, video selection, and play/pause pass in a fresh unsigned Edge profile. The video used was `jNQXAC9IVRw` (Me at the zoo).
- The same operations also pass through the actual running companion HTTP API at the laptop's Wi-Fi address, using the shared client and a temporary paired device. The temporary test device was then revoked.
- The built APK is served successfully over the laptop's private IPv4 address; its HTTP download SHA-256 matches the built artifact.

The live reports are saved under `.local`. These local test artifacts are gitignored.

The compiled Windows app was launched against a fresh companion. Its native pairing window reached idle, displayed the QR control, and switched to the installation view. One startup sample measured 96 MB for the WPF window and 53 MB for the companion. Closing the window exits the WPF process.

## Remaining phone acceptance

Install the APK on the user's Android phone, approve any required Windows Private Wi-Fi access, and complete the checklist in `requirements.md`: pair, search, select, play/pause, background/resume, restart, and revoke. Phone screen layout, Android Keystore persistence, and background behavior have not been exercised on physical hardware. Google account login was not part of the public-video checks.

The Windows app's **Allow Wi-Fi access** button requests a narrow rule through Windows UAC. Administrator approval must be given in the Windows prompt; the app cannot approve it. Access remains blocked if Windows approval is declined or unavailable.
