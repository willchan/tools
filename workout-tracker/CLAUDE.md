# workout-tracker — App-Specific Rules

Everything in the root `CLAUDE.md` applies here. This file covers what's
specific to this app: an optional native iOS shell and an Apple Watch
companion around the same TypeScript PWA. Background and rejected
alternatives are in the architecture decision records:

- [ADR 0001 — Web-first with a Capacitor shell](docs/adr/0001-web-first-with-capacitor-shell.md)
- [ADR 0002 — Apple Watch as a thin remote](docs/adr/0002-apple-watch-remote.md)

## Guiding principle

**TypeScript is the source of truth.** Native UIs (the `App` shell,
`LiveActivityWidget`, the watch app) render TS-computed state and report user
actions back; they don't decide what happens next. Swift beyond layout/glue
(encoding, queuing) lives in `ios/App/AppLogic` with XCTest. New native targets
are added via checked-in `xcodeproj` scripts, not the Xcode GUI.

## Native shell (`ios/`)

An optional native shell (`ios/`, Swift/SwiftUI, built via Capacitor) wraps the
same `src/` web app in a WKWebView. It exists only because iOS throttles
background service workers and gates Live Activities (ActivityKit) and watch
workouts (HealthKit, WatchConnectivity) behind native APIs. It is not a second
UI implementation. Keep Swift code thin: view-controller glue,
`AppDelegate`/`SceneDelegate` boilerplate, the Live Activity widget's SwiftUI
layout, the watch app's SwiftUI layout. Real logic belongs in `src/` TypeScript,
where it's covered by TDD.

See `README.md` ("iOS App (Capacitor)") and `ios/MANUAL_SETUP.md` ("Test
coverage layers") for how the pieces are built and tested.

## Rules

1. **TDD covers `src/native/*` too.** The plugin-call wiring in `src/native/*`
   is TDD'd against Capacitor's own web fallbacks via
   `e2e/native-platform.spec.ts` (forcing `window.CapacitorCustomPlatform`).
   Our own plugins (e.g. `WatchBridge`) ship a web implementation for the same
   purpose. No Mac required.
2. **New Swift logic goes in `ios/App/AppLogic`, with a test.** `AppLogic` is a
   standalone local Swift package tested via `xcodebuild test -scheme AppLogic`
   with no Xcode project involved, wired into `ios.yml` on every push. Anything
   beyond thin layout/lifecycle glue (Codable message types, disk queues,
   retry logic) belongs there, not inlined in `App`, `LiveActivityWidget` or the
   watch target, where only the CI Simulator smoke test or manual on-device QA
   would catch a regression.
3. **New Xcode targets are added headlessly.** Adding a target is not
   GUI-only: `AppUITests` was added with the `xcodeproj` Ruby gem (see
   `ios/MANUAL_SETUP.md`, "Add a UI test target"). Check the script in, prefer a
   file-system synchronized group for the target's folder so later file
   additions need no `.pbxproj` edits, and commit a shared scheme when the
   target needs one.
4. **One brain.** Workout rules (set progression, bonus sets, rest timing) are
   computed only in TypeScript. The watch applies no rules of its own; it
   renders a phone-supplied snapshot and sends tap events back. See ADR 0002.

## Apple Watch companion (in progress)

Build order, from ADR 0002:

1. TS: pure `src/logic/workoutSession.ts` reducer used by both the phone UI and
   watch events; `src/logic/watchProtocol.ts` (idempotency, `setId`
   guard, snapshots); `src/native/watch.ts` wiring; `WatchBridge` plugin web
   implementation. **Done.** The TS contract for step 2 is
   `src/native/watchBridge.ts` (`WatchBridgePlugin`).
2. Native `WatchBridge` plugin (`WCSession` + disk queue); Codable protocol
   types and queue logic in `AppLogic` (iOS + watchOS), XCTest on both.
   **Done.** `AppLogic` has `WatchProtocol.swift` (Codable mirrors,
   WatchConnectivity payloads), `WatchEventQueue`, `WatchInbox` and
   `WatchSnapshotGate`. Its JSON fixtures
   (`AppLogic/Tests/AppLogicTests/Fixtures`) are also checked against the TS
   by `e2e/watch-protocol.spec.ts`: change the protocol on both sides and
   regenerate them together. The `App` target has `WatchBridgePlugin`
   (registered in `MainViewController.capacitorDidLoad`) and
   `WatchConnectivityCoordinator` (activated in `AppDelegate`).
3. Watch target via a checked-in `xcodeproj` script: HealthKit workout session
   with mirroring, start-from-either-device, minimal remote UI; entitlements,
   background modes, iOS 17 deployment target, signing.
4. TestFlight build and one real workout to read the latency logs.

## Commands

```bash
bun run cap:sync       # Build + sync web bundle into the iOS project
bun run cap:open:ios   # Open the Xcode project (needs a Mac)
```
