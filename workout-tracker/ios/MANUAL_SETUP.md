# One-time Xcode setup

Everything else in `ios/` is generated/maintained by `bun run cap:sync` and
builds headlessly in `.github/workflows/ios.yml` on a GitHub-hosted macOS
runner. The steps below need a real Mac with Xcode and only need to be done
once (or again if the widget target gets removed/regenerated).

## Test coverage layers

Three layers exist, each covering something the others can't:

1. **`e2e/native-platform.spec.ts` (Playwright, runs everywhere, no Mac needed).**
   Forces `Capacitor.isNativePlatform()` via `window.CapacitorCustomPlatform`
   (Capacitor's own override for exactly this purpose) and drives each
   plugin's real "web" fallback implementation — verifying our TS wiring
   (`src/native/*`, `notifications.ts`, `workout.ts`, `settings.ts`) calls
   the right plugin methods with the right arguments. Runs in a plain
   browser, so it can't touch actual ActivityKit/UNUserNotificationCenter.
2. **`ios.yml`'s Simulator smoke test (CI only, no Mac needed).** Boots a
   real iOS Simulator, installs the built app, and confirms the WKWebView
   actually loads and runs the web bundle inside the native shell (via a
   console marker in `src/main.ts`) — catching native-shell-level breakage
   (crash on launch, blank WebView, bad bundle) that a browser-only test
   can't see. It doesn't drive the UI, so it can't verify that tapping a
   button actually schedules a notification or starts a Live Activity.
3. **Manual verification on a real device (see "First run" below).** The
   only way to confirm actual Live Activity rendering and notification
   delivery, since Live Activities don't render in the Simulator at all and
   this repo has no XCUITest target driving on-device UI interaction.

## 1. Bundle the rest-timer notification sound

`ios/App/App/timer-done.wav` is already in the repo (a 3-beep tone matching
the web app's beep pattern), but dropping a file into the folder doesn't add
it to the app target's bundle.

1. Open `ios/App/App.xcworkspace` (or `.xcodeproj` if no CocoaPods workspace
   exists) in Xcode.
2. Drag `App/timer-done.wav` from Finder into the `App` group in the
   Project Navigator, if it isn't already listed.
3. In the file inspector, confirm "Target Membership" includes `App`.

## 2. Add the Live Activity widget extension

1. File > New > Target… > Widget Extension.
2. Name it `LiveActivityWidget`, check "Include Live Activity".
3. Delete the placeholder Live Activity Swift file Xcode generates and
   replace its contents with `ios/WidgetExtensionReference/WorkoutLiveActivityWidget.swift`
   (that file documents the content-state keys it expects — they're produced
   by `src/native/liveActivity.ts`).
4. In the Project Navigator, expand `Pods > CapacitorLiveActivity > Shared`
   (or, since this project uses Swift Package Manager, the
   `CapacitorLiveActivity` package's `Shared` group) and copy
   `GenericAttributes.swift` into the `LiveActivityWidget` target — check
   "Copy files to destination". Without this the widget target won't compile.
5. Set the widget extension's deployment target to iOS 16.2+ to match the
   app target (already set in `project.pbxproj`).

## 3. Add capabilities to the App target

Signing & Capabilities tab, on the `App` target:

- Live Activities
- Push Notifications (only needed if push-driven Live Activity updates are
  added later; local-only start/update/end doesn't require it)
- Background Modes > Background fetch

`NSSupportsLiveActivities` is already set to `true` in `Info.plist`.

## 4. First run

`npx cap sync ios` (or `bun run cap:sync`) after any dependency change, then
run on a real device — ActivityKit Live Activities don't render in the
Simulator.
