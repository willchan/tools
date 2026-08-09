# iOS native setup

> **For regular TestFlight deployments, see [`DEPLOY.md`](DEPLOY.md).**

Everything in `ios/` is generated/maintained by `bun run cap:sync` and
builds headlessly in `.github/workflows/ios.yml` (Simulator smoke test, every
push) and `.github/workflows/ios-testflight.yml` (signed build → TestFlight,
manual trigger) on GitHub-hosted macOS runners.

**The one-time Xcode steps below are already done and committed** — the
widget extension target exists in `project.pbxproj`, its capabilities
(`NSSupportsLiveActivities`, `UIBackgroundModes: fetch`) are set in
`Info.plist`, and `timer-done.wav` is in the `App` target's Resources build
phase. They're kept here as reference for what to redo if the widget target
or a resource entry ever gets deleted/regenerated — not as a checklist to
follow before this feature works.

## No Xcode needed for day-to-day iteration

`ios/App/LiveActivityWidget/` is an Xcode **file system synchronized
group** (`PBXFileSystemSynchronizedRootGroup` in `project.pbxproj`) — any
file dropped into that folder (Swift source, `Assets.xcassets` entries) is
picked up by the `LiveActivityWidgetExtension` target automatically, with
no `.pbxproj` editing and no Xcode GUI step. Concretely:

- `LiveActivityWidget.swift` in that folder *is* the real, compiled widget
  UI (its `WorkoutLiveActivityWidget` struct is what
  `LiveActivityWidgetBundle.swift`'s `@main` references) — edit it
  directly and commit. There was also a separate, uncompiled
  `ios/WidgetExtensionReference/` copy meant to be hand-pasted into Xcode;
  it's been removed since it had silently drifted out of sync with this
  real file and was actively misleading — always edit
  `LiveActivityWidget.swift` here instead.
- `Assets.xcassets/LiveActivityIcon.imageset` is the app icon used in the
  Live Activity's lock-screen banner and compact/minimal Dynamic Island —
  same deal, just files in a folder.

So the loop is: edit the `.swift`/asset files → commit → push → run the
"iOS TestFlight" workflow from the Actions tab (or `gh workflow run
ios-testflight.yml` / the GitHub API) → ~10-15 min later the build is in
TestFlight on your phone. No Mac or Xcode required at any point, since
TESTFLIGHT_SETUP.md's signing setup is already complete for this repo.

The only hard limit: ActivityKit Live Activities don't render in the iOS
Simulator at all, so actually *seeing* a change to the widget still needs
a real device — `ios.yml`'s Simulator smoke test only proves the native
shell boots and the web bundle runs, not that the widget looks right.
There's also no XCUITest target driving on-device UI interaction, so a
Live Activity's actual rendering is verified by eye, on a device, via
TestFlight.

## Test coverage layers

Four layers exist, each covering something the others can't:

1. **`e2e/native-platform.spec.ts` (Playwright, runs everywhere, no Mac needed).**
   Forces `Capacitor.isNativePlatform()` via `window.CapacitorCustomPlatform`
   (Capacitor's own override for exactly this purpose) and drives each
   plugin's real "web" fallback implementation — verifying our TS wiring
   (`src/native/*`, `notifications.ts`, `workout.ts`, `settings.ts`) calls
   the right plugin methods with the right arguments. Runs in a plain
   browser, so it can't touch actual ActivityKit/UNUserNotificationCenter.
2. **`AppLogic`'s XCTest suite (CI only, no Mac needed).** `App` and
   `LiveActivityWidget` are Xcode targets with no unit test target of their
   own — adding one means editing `App.xcodeproj`'s target graph, which has
   no Apple-provided CLI (project mutation is GUI-only, or third-party
   tooling; see "Link `AppLogic` into the `App` target" below for why
   linking a package is a one-time manual step rather than something
   scripted). `AppLogic` sidesteps that: it's a standalone local Swift
   package (its own `Package.swift`), and `xcodebuild test -scheme
   AppLogic` builds/tests it directly with no Xcode project involved. This
   is where real logic pulled out of the app/widget targets (e.g.
   `WebViewScrollChrome`, the `MainViewController` scroll-indicator
   config) gets actual regression coverage, run in `ios.yml` on every
   push. New Swift logic should go here, not inlined in
   `App`/`LiveActivityWidget`.
3. **`ios.yml`'s Simulator smoke test (CI only, no Mac needed).** Boots a
   real iOS Simulator, installs the built app, and confirms the WKWebView
   actually loads and runs the web bundle inside the native shell (via a
   console marker in `src/main.ts`) — catching native-shell-level breakage
   (crash on launch, blank WebView, bad bundle) that a browser-only test
   can't see. It doesn't drive the UI, so it can't verify that tapping a
   button actually schedules a notification or starts a Live Activity.
4. **Manual verification on a real device, via TestFlight.** The only way
   to confirm actual Live Activity rendering and notification delivery,
   for the reasons above.

## Reference: how the one-time setup was done

Only relevant if the widget target or these resource entries need to be
recreated from scratch (e.g. after a `project.pbxproj` regeneration).

### Bundle the rest-timer notification sound

`ios/App/App/timer-done.wav` is in the repo (a 3-beep tone matching the web
app's beep pattern); it needs to be added to the `App` target's bundle:

1. Open `ios/App/App.xcworkspace` (or `.xcodeproj` if no CocoaPods workspace
   exists) in Xcode.
2. Drag `App/timer-done.wav` from Finder into the `App` group in the
   Project Navigator, if it isn't already listed.
3. In the file inspector, confirm "Target Membership" includes `App`.

### Add the Live Activity widget extension

1. File > New > Target… > Widget Extension.
2. Name it `LiveActivityWidget`, check "Include Live Activity".
3. Delete the placeholder Live Activity Swift file Xcode generates —
   `LiveActivityWidget.swift` (committed in this folder) replaces it once
   the target's folder is pointed at this directory.
4. In the Project Navigator, expand `Pods > CapacitorLiveActivity > Shared`
   (or, since this project uses Swift Package Manager, the
   `CapacitorLiveActivity` package's `Shared` group) and copy
   `GenericAttributes.swift` into the `LiveActivityWidget` target — check
   "Copy files to destination". Without this the widget target won't compile.
   (Already committed in this folder too.)
5. Set the widget extension's deployment target to iOS 16.2+ to match the
   app target (already set in `project.pbxproj`).

### Add capabilities to the App target

Signing & Capabilities tab, on the `App` target:

- Live Activities
- Push Notifications (only needed if push-driven Live Activity updates are
  added later; local-only start/update/end doesn't require it)
- Background Modes > Background fetch

(`NSSupportsLiveActivities` and `UIBackgroundModes: fetch` are already set
in `Info.plist`.)

### Link `AppLogic` into the `App` target

`ios/App/AppLogic` (see "Test coverage layers" above) is a plain local
Swift package — adding code and tests to it needs no Xcode, but making
`App` (or `LiveActivityWidget`) able to actually call into it required
linking it as a package dependency once, which did need Xcode's GUI
(Apple's CLI has no way to edit an `.xcodeproj`'s target graph). Already
done — `MainViewController` calls
`AppLogic.WebViewScrollChrome.hideNativeIndicators(on:)`. Steps below are
for reference if the link ever needs to be redone (e.g. after a
`project.pbxproj` regeneration):

1. Open `ios/App/App.xcworkspace` (or `.xcodeproj`) in Xcode.
2. File > Add Package Dependencies… > Add Local…, select `ios/App/AppLogic`.
3. When prompted for which target(s) to add it to, check `App` (and
   `LiveActivityWidget` too, if the widget needs it).
4. Build once (⌘B) to confirm it resolves, then commit the resulting
   `project.pbxproj`/`Package.resolved` changes.
