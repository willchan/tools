# 0002. Apple Watch companion as a thin remote

- **Status:** Accepted, 2026-09. Steps 1 (TS) and 2 (native `WatchBridge`,
  `AppLogic` on iOS + watchOS) are implemented. Steps 3–4 are pending.
- **Related:** [0001](0001-web-first-with-capacitor-shell.md)

## Context

The user only uses the app on their iPhone. Today they start a workout twice:
once in the phone app, and once as "Traditional Strength Training" in the
watch Fitness app (for heart rate, calories and Activity rings). They want:

- **The watch as a simple remote** for the current workout: complete a set,
  skip or adjust rest, finish.
- **No divergence.** Pulling out the phone at any time shows exactly the same
  state as the watch.
- **Start once.** Starting on either device starts the other, and the watch
  app's own `HKWorkoutSession` replaces the Fitness app workout.

All workout rules live in TypeScript and IndexedDB inside the Capacitor
WKWebView (ADR 0001). While the phone is locked, workout mirroring may keep the
native process alive while WKWebView's JavaScript is suspended. Nobody has
measured this yet.

## Decision

**One brain: the phone's existing TypeScript and IndexedDB.** The watch is a
thin SwiftUI remote that ports no workout rules (e.g. bonus sets from
`src/logic/volume.ts`). It only registers the tap, runs a rest countdown from a
phone-supplied duration, and plays its own haptic when rest ends.

- **Phone → watch:** a numbered, display-ready snapshot sent with
  `updateApplicationContext`. The watch drops any snapshot older than the one
  it has.
- **Watch → phone:** tap events `{v, id, at, type, setId, ...}` where `type` is
  `completeSet` (with reps), `skipRest`, `adjustRest`, `start` or `finish`.
- **Start from either device:** a watch start calls
  `startMirroringToCompanionDevice` (iOS 17 / watchOS 10), which wakes the
  phone app in the background. A phone start calls
  `HKHealthStore.startWatchApp(with:)`.
- **One reducer.** Every in-workout action, whether from a phone tap or a
  watch event, goes through one pure, DOM-free TS function
  (`src/logic/workoutSession.ts`). A parity test checks that a watch
  `completeSet` leaves IndexedDB identical to the same UI tap.

Required safeguards:

1. The native plugin writes each tap to a disk queue *before* acking the
   watch. A tap leaves the queue only after TS has committed it to IndexedDB.
2. Each tap has an idempotency id, recorded in the same IndexedDB transaction
   as the set, so a redelivered tap is a no-op.
3. `setId` guard: a tap for a set the phone has already moved past is
   rejected, and a fresh snapshot is pushed.
4. Taps are applied using the watch's `at` timestamp, not arrival time, so
   delivery delay doesn't shift set times or rest end times.
5. Finish goes through the same queue.
6. Latency instrumentation: native-received vs. JS-applied times are logged
   with `log()` (`src/logic/logger.ts`). One real workout with the phone
   locked will show whether JS is being suspended.

**The JS-suspension risk is tested, not designed around.** If JS is
suspended, the watch shows "Waiting for iPhone…" and stops advancing until the
phone wakes. Because of the queue and idempotency ids, no taps are lost. The
fallback, if needed, is to run the same TS reducer natively in JavaScriptCore,
not to port it to Swift. The queue, protocol, ids and guards above are all
reused by that fallback.

### Build order

1. TS (Playwright TDD): the reducer, id/`setId`/timestamp rules,
   `src/native/watch.ts`, and a web implementation of our `WatchBridge`
   Capacitor plugin that records pushes and has a test-only `emit`. Plus the
   parity test.
2. Native `WatchBridge` (`WCSession` + disk queue). Codable protocol types and
   queue logic go in `ios/App/AppLogic`, made multi-platform (iOS + watchOS),
   with XCTests on both simulators in `ios.yml`.
3. Watch target, added by a checked-in `xcodeproj` gem script as a file-system
   synchronized group: HealthKit and mirroring, start-from-either-device,
   minimal remote UI, HealthKit entitlements, the `workout-processing`
   background mode, iOS deployment target raised to 17, a new watch bundle ID,
   and signing in `ios-testflight.yml`.
4. TestFlight build, then one real workout to read the latency logs.

### Step 2 notes, for step 3

What the phone side now expects from the watch app:

- **Sending taps.** Build a `WatchEvent` (AppLogic), wrap it with
  `WatchMessage.eventMessage`, and send it with `transferUserInfo` (guaranteed,
  queued by the system). When `isReachable`, also `sendMessage` it for
  latency: a reply with `WatchMessage.ackedID` means it's on the phone's disk;
  an `error` reply or failure means rely on (or redo) the transfer. The phone
  dedupes by `id`, so sending both is safe.
- **Receiving snapshots.** Read `WatchMessage.snapshot(from:)` from
  `didReceiveApplicationContext` and `receivedApplicationContext` at launch,
  and pass each through a `WatchSnapshotGate` seeded with what's on screen.
- **`startWatchApp` from the phone** reaches the watch app's
  `handle(_ workoutConfiguration:)`, including while a watch workout is
  already running (e.g. the watch started it). That handler must do nothing
  when an `HKWorkoutSession` exists.
- **HealthKit on the phone.** `WatchBridgePlugin.startWatchApp` calls
  `HKHealthStore.startWatchApp` for real, but only when a paired watch has
  the app installed, which can't happen before step 3. It builds and links
  now (HealthKit autolinks), with no entitlement. Step 3 must add the
  HealthKit entitlement (and usage strings) to `App` at the same time as the
  watch target, or `startWatchApp` fails at runtime.
- **Background wakes.** `WatchConnectivityCoordinator` activates `WCSession`
  in `AppDelegate`, so taps are queued even when mirroring wakes the app
  without a WebView. The queue file is written with
  `completeUntilFirstUserAuthentication` protection so a locked phone can
  write it.
- **Native logging.** Rejected or undecodable taps and queue-file recovery
  go to the unified log (subsystem `com.willchan.workouttracker`, category
  `WatchBridge`), not the in-app `log()`.

## Alternatives considered

- **All-native rewrite (Swift on phone and watch).** Rejected. It throws away
  the tested TS logic and Playwright TDD workflow and gives up OTA updates, for
  a problem (JS suspension) that hasn't been observed yet. See ADR 0001.
- **The watch runs its own Swift copy of the rules** (bonus sets, progression)
  so it can advance on its own. Rejected. Two implementations would drift, and
  phone/watch divergence is exactly what the user ruled out. Reconciling two
  sets of state is harder than using one brain.
- **Keep everything in TS until evidence, adding no native safeguards up
  front.** Rejected. The disk queue, idempotency ids and `setId` guard are what
  make a suspended WebView lose no data, and the JavaScriptCore fallback needs
  them anyway. Deferring them risks losing sets in the one real-workout test
  that would produce the evidence.

## Consequences

- The watch can only advance as fast as phone JS applies taps. If JS is
  suspended while locked, the watch waits.
- The TS reducer is now the one entry point for in-workout actions, so the
  phone UI and watch have to change together.
- The iOS deployment target goes up to 17 (for workout mirroring).
- The watch target adds a signing identity, bundle ID and HealthKit
  entitlements to CI and TestFlight setup.

## Revisit when

- **JS suspension is confirmed** by the latency logs: move the same TS reducer
  into JavaScriptCore on the native side, fed by the existing queue.
- **The watch needs more than remote features** (browsing history, editing
  templates, working without the phone): the thin-remote model no longer fits.
- **The app leaves the web-first repo:** consider going native in its own
  repo, which removes the WebView as the brain.
